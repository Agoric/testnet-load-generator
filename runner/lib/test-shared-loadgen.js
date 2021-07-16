/* global process Buffer */

import { PassThrough } from 'stream';

import { childProcessDone } from './helpers/child-process.js';
import LineStreamTransform from './helpers/line-stream-transform.js';
import { PromiseAllOrErrors, tryTimeout } from './helpers/async.js';
import { whenStreamSteps } from './helpers/stream-steps.js';
import { httpRequest, getConsoleAndStdio } from './test-helpers.js';

const loadgenStartRE = /deploy.*loadgen\/loop\.js/;
const loadgenReadyRE = /server running/;

/**
 *
 * @param {Object} powers
 * @param {import("./helpers/child-process.js").PipedSpawn} powers.pipedSpawn Spawn with piped output
 * @returns {import("./test-operations.js").TestOperations['runLoadgen']}
 *
 */
export const makeLoadgenOperation = ({ pipedSpawn }) => {
  return harden(async ({ stdout, stderr, timeout = 30, config = {} }) => {
    const { console, stdio } = getConsoleAndStdio('loadgen', stdout, stderr);

    console.log('Starting loadgen');

    const loadgenEnv = Object.create(process.env);
    // loadgenEnv.DEBUG = 'agoric';

    const launcherCp = pipedSpawn('agoric', ['deploy', 'loadgen/loop.js'], {
      stdio,
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
    const combinedOutput = new PassThrough();
    const outLines = new LineStreamTransform({ lineEndings: true });
    const errLines = new LineStreamTransform({ lineEndings: true });
    launcherCp.stdout.pipe(outLines).pipe(combinedOutput);
    launcherCp.stderr.pipe(errLines).pipe(combinedOutput);

    const [deploying, tasksReady, outputParsed] = whenStreamSteps(
      combinedOutput,
      [{ matcher: loadgenStartRE }, { matcher: loadgenReadyRE }],
      {
        waitEnd: false,
      },
    );

    const cleanCombined = () => {
      launcherCp.stdout.unpipe(outLines);
      launcherCp.stderr.unpipe(errLines);
    };
    outputParsed.then(cleanCombined, cleanCombined);

    const done = PromiseAllOrErrors([outputParsed, loadgenDone]).then(() => {});

    return tryTimeout(
      timeout * 1000,
      async () => {
        await deploying;

        console.log('Load gen app running');

        const ready = tasksReady.then(async () => {
          console.log('Making request to loadgen');
          const body = Buffer.from(JSON.stringify(config), 'utf8');

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
            throw new Error('Could not start faucet');
          }
        });

        return harden({
          stop,
          done,
          ready,
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
