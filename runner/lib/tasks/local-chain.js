/* global process */

import { dirname } from 'path';
import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';

import {
  childProcessDone,
  makeSpawnWithPrintAndPipeOutput,
} from '../helpers/child-process.js';
import LineStreamTransform from '../helpers/line-stream-transform.js';
import { PromiseAllOrErrors, tryTimeout } from '../helpers/async.js';
import { whenStreamSteps } from '../helpers/stream-steps.js';
import {
  getArgvMatcher,
  getChildMatchingArgv,
  wrapArgvMatcherIgnoreEnvShebang,
  getConsoleAndStdio,
} from './helpers.js';
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
  spawn,
  findDirByPrefix,
  makeFIFO,
  getProcessInfo,
}) => {
  const pipedSpawn = makeSpawnWithPrintAndPipeOutput({
    spawn,
    end: false,
  });

  /** @param {import("./types.js").TaskBaseOptions & {config?: {reset?: boolean}}} options */
  const setupTasks = async ({ stdout, stderr, config: { reset } = {} }) => {
    const { console, stdio } = getConsoleAndStdio(
      'setup-tasks',
      stdout,
      stderr,
    );

    console.log('Starting');

    if (reset) {
      console.log('Resetting chain node and client state');
      const stateDir = dirname(chainDirPrefix);
      await childProcessDone(pipedSpawn('rm', ['-rf', stateDir], { stdio }));
      await childProcessDone(
        pipedSpawn('git', ['checkout', '--', stateDir], {
          stdio,
        }),
      );
    }
    await childProcessDone(pipedSpawn('agoric', ['install'], { stdio }));

    console.log('Done');
  };

  /** @param {import("./types.js").TaskBaseOptions} options */
  const runChain = async ({ stdout, stderr, timeout = 120 }) => {
    const { console, stdio } = getConsoleAndStdio('chain', stdout, stderr);

    console.log('Starting chain');

    const slogFifo = await makeFIFO('chain.slog');
    const slogLines = new LineStreamTransform();
    const slogPipeResult = pipeline(slogFifo, slogLines);

    const chainEnv = Object.create(process.env);
    chainEnv.SLOGFILE = slogFifo.path;

    const launcherCp = pipedSpawn(
      'agoric',
      ['start', 'local-chain', '--verbose'],
      { stdio, env: chainEnv, detached: true },
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
            slogFifo.close();
          }
        };

        return harden({
          stop,
          done,
          ready: firstBlock,
          slogLines: {
            [Symbol.asyncIterator]: () => slogLines[Symbol.asyncIterator](),
          },
          storageLocation,
          processInfo,
        });
      },
      async () => {
        // Avoid unhandled rejections for promises that can no longer be handled
        Promise.allSettled([done, firstBlock]);
        launcherCp.kill();
        slogFifo.close();
      },
    );
  };

  /** @param {import("./types.js").TaskBaseOptions} options */
  const runClient = async ({ stdout, stderr, timeout = 60 }) => {
    const { console, stdio } = getConsoleAndStdio('client', stdout, stderr);

    console.log('Starting client');

    const launcherCp = pipedSpawn('agoric', ['start', 'local-solo'], {
      stdio,
      detached: true,
    });

    const clientDone = childProcessDone(launcherCp);

    clientDone.then(
      () => console.log('Client exited successfully'),
      (error) => console.error('Client exited with error', error),
    );

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
    setupTasks,
    runChain,
    runClient,
    runLoadgen: makeLoadgenTask({ pipedSpawn }),
  });
};
