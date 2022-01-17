/* global process */

import { dirname } from 'path';
import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';

import {
  childProcessDone,
  makeSpawnWithPipedStream,
  makePrinterSpawn,
} from '../helpers/child-process.js';
import BufferLineTransform from '../helpers/buffer-line-transform.js';
import { PromiseAllOrErrors, tryTimeout } from '../helpers/async.js';
import { fsStreamReady } from '../helpers/fs.js';
import { whenStreamSteps } from '../helpers/stream.js';
import {
  getArgvMatcher,
  getChildMatchingArgv,
  wrapArgvMatcherIgnoreEnvShebang,
  getConsoleAndStdio,
} from './helpers.js';
import { makeGetEnvInfo } from './shared-env-info.js';
import { makeLoadgenTask } from './shared-loadgen.js';

const pipeline = promisify(pipelineCallback);

const chainDirPrefix = '_agstate/agoric-servers/local-chain-';

const chainStartRE = /ag-chain-cosmos start --home=(.*)$/;
const chainBlockBeginRE = /block-manager: block (\d+) begin$/;
const clientStartRE = /\bsolo\b\S+entrypoint\.[cm]?js start/;
const clientWalletReadyRE = /(?:Deployed Wallet!|Don't need our provides: wallet)/;

const chainNodeArgvMatcher = wrapArgvMatcherIgnoreEnvShebang(
  getArgvMatcher([/node$/, /chain-entrypoint/]),
);
const chainGoArgvMatcher = getArgvMatcher([/(?:sh|node)$/, /ag-chain-cosmos$/]);
/** @param {string[]} argv */
const chainArgvMatcher = (argv) =>
  chainNodeArgvMatcher(argv) || chainGoArgvMatcher(argv);
const clientArgvMatcher = wrapArgvMatcherIgnoreEnvShebang(
  getArgvMatcher([/node$/, /\bsolo\b\S+entrypoint\.[cm]?js/]),
);

/**
 *
 * @param {Object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("../helpers/fs.js").MakeFIFO} powers.makeFIFO Make a FIFO file readable stream
 * @param {import("../helpers/fs.js").FindByPrefix} powers.findDirByPrefix
 * @param {import("../helpers/procsfs.js").GetProcessInfo} powers.getProcessInfo
 * @returns {import("./types.js").OrchestratorTasks}
 *
 */
export const makeTasks = ({
  spawn: cpSpawn,
  findDirByPrefix,
  makeFIFO,
  getProcessInfo,
}) => {
  const spawn = makeSpawnWithPipedStream({
    spawn: cpSpawn,
    end: false,
  });

  /** @param {import("./types.js").TaskBaseOptions & {config?: {reset?: boolean}}} options */
  const setupTasks = async ({ stdout, stderr, config: { reset } = {} }) => {
    const { console, stdio } = getConsoleAndStdio(
      'setup-tasks',
      stdout,
      stderr,
    );
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting');

    if (reset) {
      console.log('Resetting chain node and client state');
      const stateDir = dirname(chainDirPrefix);
      await childProcessDone(printerSpawn('rm', ['-rf', stateDir], { stdio }));
      await childProcessDone(
        printerSpawn('git', ['checkout', '--', stateDir], {
          stdio,
        }),
      );
    }
    await childProcessDone(printerSpawn('agoric', ['install'], { stdio }));

    console.log('Done');
  };

  /** @param {import("./types.js").TaskBaseOptions} options */
  const runChain = async ({ stdout, stderr, timeout = 120 }) => {
    const { console, stdio } = getConsoleAndStdio('chain', stdout, stderr);
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting chain');

    const slogFifo = await makeFIFO('chain.slog');
    const slogReady = fsStreamReady(slogFifo);
    const slogLines = new BufferLineTransform();
    const slogPipeResult = pipeline(slogFifo, slogLines);

    const chainEnv = Object.create(process.env);
    chainEnv.SLOGFILE = slogFifo.path;

    const launcherCp = printerSpawn(
      'agoric',
      ['start', 'local-chain', '--verbose'],
      { stdio: ['ignore', 'pipe', stdio[2]], env: chainEnv, detached: true },
    );

    let stopped = false;

    // Chain exit with code 98 when killed
    const chainDone = childProcessDone(launcherCp, {
      ignoreExitCode: true,
    }).then((code) => {
      if (code !== 0 && (!stopped || code !== 98)) {
        return Promise.reject(
          new Error(`Chain exited with non-zero code: ${code}`),
        );
      }
      return 0;
    });

    chainDone.then(
      () => console.log('Chain exited successfully'),
      (error) => console.error('Chain exited with error', error),
    );

    launcherCp.stdout.pipe(stdio[1], { end: false });
    const [chainStarted, firstBlock, outputParsed] = whenStreamSteps(
      launcherCp.stdout,
      [
        { matcher: chainStartRE },
        { matcher: chainBlockBeginRE, resultIndex: -1 },
      ],
      {
        waitEnd: false,
      },
    );

    const done = PromiseAllOrErrors([
      slogPipeResult,
      outputParsed,
      chainDone,
    ]).then(() => {});

    const ready = PromiseAllOrErrors([firstBlock, slogReady]).then(() => {});

    return tryTimeout(
      timeout * 1000,
      async () => {
        await chainStarted;

        console.log('Chain running');

        const [storageLocation, processInfo] = await PromiseAllOrErrors([
          chainStarted.then(findDirByPrefix),
          getProcessInfo(
            /** @type {number} */ (launcherCp.pid),
          ).then((launcherInfo) =>
            getChildMatchingArgv(launcherInfo, chainArgvMatcher),
          ),
        ]);

        const stop = () => {
          stopped = true;
          process.kill(processInfo.pid);
          if (slogFifo.pending) {
            slogLines.end();
            slogFifo.close();
          }
        };

        return harden({
          stop,
          done,
          ready,
          slogLines: {
            [Symbol.asyncIterator]: () => slogLines[Symbol.asyncIterator](),
          },
          storageLocation,
          processInfo,
        });
      },
      async () => {
        // Avoid unhandled rejections for promises that can no longer be handled
        Promise.allSettled([done, ready]);
        launcherCp.kill();
        slogFifo.close();
      },
    );
  };

  /** @param {import("./types.js").TaskBaseOptions} options */
  const runClient = async ({ stdout, stderr, timeout = 60 }) => {
    const { console, stdio } = getConsoleAndStdio('client', stdout, stderr);
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting client');

    const launcherCp = printerSpawn('agoric', ['start', 'local-solo'], {
      stdio: ['ignore', 'pipe', stdio[2]],
      detached: true,
    });

    const clientDone = childProcessDone(launcherCp);

    clientDone.then(
      () => console.log('Client exited successfully'),
      (error) => console.error('Client exited with error', error),
    );

    launcherCp.stdout.pipe(stdio[1], { end: false });
    const [clientStarted, walletReady, outputParsed] = whenStreamSteps(
      launcherCp.stdout,
      [
        { matcher: clientStartRE, resultIndex: -1 },
        { matcher: clientWalletReadyRE, resultIndex: -1 },
      ],
      {
        waitEnd: false,
      },
    );

    const done = PromiseAllOrErrors([outputParsed, clientDone]).then(() => {});

    return tryTimeout(
      timeout * 1000,
      async () => {
        await clientStarted;

        console.log('Client running');

        const processInfo = await getProcessInfo(
          /** @type {number} */ (launcherCp.pid),
        ).then((launcherInfo) =>
          getChildMatchingArgv(launcherInfo, clientArgvMatcher),
        );

        const stop = () => process.kill(processInfo.pid);

        return harden({
          stop,
          done,
          ready: walletReady,
        });
      },
      async () => {
        // Avoid unhandled rejections for promises that can no longer be handled
        Promise.allSettled([done, walletReady]);
        launcherCp.kill();
      },
    );
  };

  return harden({
    getEnvInfo: makeGetEnvInfo({ spawn }),
    setupTasks,
    runChain,
    runClient,
    runLoadgen: makeLoadgenTask({ spawn }),
  });
};
