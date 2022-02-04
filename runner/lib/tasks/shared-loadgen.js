/* global process Buffer */

import { Transform, pipeline as pipelineCallback } from 'stream';
import { promisify } from 'util';

import {
  childProcessDone,
  makePrinterSpawn,
} from '../helpers/child-process.js';
import LineStreamTransform from '../helpers/line-stream-transform.js';
import { PromiseAllOrErrors, tryTimeout } from '../helpers/async.js';
import { combineAndPipe, whenStreamSteps } from '../helpers/stream.js';
import {
  httpRequest,
  getConsoleAndStdio,
  cleanAsyncIterable,
} from './helpers.js';

const pipeline = promisify(pipelineCallback);

const loadgenStartRE = /deploy.*loadgen\/loop\.js/;
const loadgenReadyRE = /server running/;

const jsonDataRE = /^\{.*\}$/;

/**
 *
 * @param {Object} powers
 * @param {import("child_process").spawn} powers.spawn spawn
 * @returns {import("./types.js").OrchestratorTasks['runLoadgen']}
 */
export const makeLoadgenTask = ({ spawn }) => {
  return harden(async ({ stdout, stderr, timeout = 30, config }) => {
    const { console, stdio } = getConsoleAndStdio('loadgen', stdout, stderr);
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting loadgen');

    const loadgenEnv = Object.create(process.env);
    // loadgenEnv.DEBUG = 'agoric';

    const launcherCp = printerSpawn('agoric', ['deploy', 'loadgen/loop.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: loadgenEnv,
      detached: true,
    });

    let stopped = false;
    const stop = () => {
      stopped = true;
      launcherCp.kill();
    };

    // Load gen exit with non-zero code when killed
    const loadgenDone = childProcessDone(launcherCp).catch((err) =>
      stopped ? 0 : Promise.reject(err),
    );

    loadgenDone.then(
      () => console.log('Load gen app stopped successfully'),
      (error) => console.error('Load gen app stopped with error', error),
    );

    // The agoric deploy output is currently sent to stderr
    // Combine both stderr and stdout in to detect both steps
    // accommodating future changes
    const combinedOutput = combineAndPipe(launcherCp.stdio, stdio, false);

    const taskEvents = new Transform({
      objectMode: true,
      /**
       * @param {string} data
       * @param {string} encoding
       * @param {(error?: Error | null, data?: Record<string, unknown>) => void} callback
       */
      transform(data, encoding, callback) {
        if (jsonDataRE.test(data)) {
          try {
            callback(null, JSON.parse(data));
            return;
          } catch (error) {
            console.warn('Failed to parse loadgen event', data, error);
          }
        }
        callback();
      },
    });

    /** @param {unknown} newConfig */
    const updateConfig = async (newConfig = {}) => {
      console.log('Making request to loadgen');
      const body = Buffer.from(JSON.stringify(newConfig), 'utf8');

      const res = await httpRequest('http://127.0.0.1:3352/config', {
        body,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.byteLength,
        },
      });
      // Consume and discard the response
      for await (const _ of res);

      if (!res.statusCode || res.statusCode >= 400) {
        throw new Error('Could not update loadgen config');
      }
    };

    const [deploying, tasksReady, initialOutputParsed] = whenStreamSteps(
      combinedOutput,
      [{ matcher: loadgenStartRE }, { matcher: loadgenReadyRE }],
      {
        waitEnd: false,
        close: false,
      },
    );

    const outputParsed = initialOutputParsed.then(
      () => pipeline(combinedOutput, new LineStreamTransform(), taskEvents),
      (err) => {
        combinedOutput.destroy(err);
        return Promise.reject(err);
      },
    );

    const done = PromiseAllOrErrors([outputParsed, loadgenDone]).then(() => {});

    return tryTimeout(
      timeout * 1000,
      async () => {
        await deploying;

        console.log('Load gen app running');

        const ready = tasksReady.then(() =>
          config != null ? updateConfig(config) : undefined,
        );

        return harden({
          stop,
          done,
          ready,
          updateConfig,
          taskEvents: cleanAsyncIterable(taskEvents),
        });
      },
      async () => {
        // Avoid unhandled rejections for promises that can no longer be handled
        Promise.allSettled([loadgenDone, tasksReady]);
        launcherCp.kill();
      },
    );
  });
};
