/* global process Buffer */
/* eslint-disable no-await-in-loop */

import { join as joinPath } from 'path';
import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';

import TOML from '@iarna/toml';

import {
  childProcessDone,
  makeSpawnWithPrintAndPipeOutput,
} from '../helpers/child-process.js';
import LineStreamTransform from '../helpers/line-stream-transform.js';
import {
  PromiseAllOrErrors,
  tryTimeout,
  sleep,
  aggregateTryFinally,
} from '../helpers/async.js';
import { whenStreamSteps } from '../helpers/stream-steps.js';
import {
  getArgvMatcher,
  getChildMatchingArgv,
  wrapArgvMatcherIgnoreEnvShebang,
  getConsoleAndStdio,
  httpRequest,
} from './helpers.js';
import { makeLoadgenTask } from './shared-loadgen.js';

const pipeline = promisify(pipelineCallback);

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
const fetchAsJSON = async (url) => {
  const res = await httpRequest(url);
  const chunks = [];
  for await (const chunk of res) {
    chunks.push(chunk);
  }

  if (!res.statusCode || res.statusCode >= 400) {
    throw new Error(`HTTP request error: ${res.statusCode}`);
  }

  // TODO: Check `res.headers['content-type']` for type and charset
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
};

const clientStateDir = '_agstate/agoric-servers/testnet-8000';

const chainSwingSetLaunchRE = /launch-chain: Launching SwingSet kernel$/;
const chainBlockBeginRE = /block-manager: block (\d+) begin$/;
const clientStartRE = /\bsolo\b\S+entrypoint\.[cm]?js.* setup(?: .*)$/;
const clientWalletReadyRE = /(?:Deployed Wallet!|Don't need our provides: wallet)/;
const clientSwingSetReadyRE = /start: swingset running$/;

const clientArgvMatcher = wrapArgvMatcherIgnoreEnvShebang(
  getArgvMatcher([/node$/, /\bsolo\b\S+entrypoint\.[cm]?js/]),
);

/**
 *
 * @param {Object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {import("../helpers/fs.js").MakeFIFO} powers.makeFIFO Make a FIFO file readable stream
 * @param {import("../helpers/procsfs.js").GetProcessInfo} powers.getProcessInfo
 * @returns {import("./types.js").OrchestratorTasks}
 *
 */
export const makeTasks = ({ spawn, fs, makeFIFO, getProcessInfo }) => {
  const pipedSpawn = makeSpawnWithPrintAndPipeOutput({
    spawn,
    end: false,
  });

  const chainStateDir = String(
    process.env.AG_CHAIN_COSMOS_HOME ||
      joinPath(process.env.HOME || '~', '.ag-chain-cosmos'),
  );

  let testnetOrigin = 'https://testnet.agoric.net';

  /** @param {import("./types.js").TaskBaseOptions & {config?: {reset?: boolean, chainOnly?: boolean, withMonitor?: boolean, testnetOrigin?: string}}} options */
  const setupTasks = async ({
    stdout,
    stderr,
    timeout = 120,
    config: {
      reset = true,
      chainOnly,
      withMonitor = true,
      testnetOrigin: testnetOriginOption,
    } = {},
  }) => {
    const { console, stdio } = getConsoleAndStdio(
      'setup-tasks',
      stdout,
      stderr,
    );

    console.log('Starting');

    if (testnetOriginOption) {
      testnetOrigin = testnetOriginOption;
    }

    if (withMonitor !== false) {
      if (reset) {
        console.log('Resetting chain node');
        await childProcessDone(
          pipedSpawn('rm', ['-rf', chainStateDir], { stdio }),
        );
      }

      const chainDirStat = await fs
        .stat(chainStateDir)
        .catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));

      if (!chainDirStat) {
        console.log('Fetching network config and genesis');
        const {
          chainName,
          peers,
          seeds,
        } = /** @type {{chainName: string, peers: string[], seeds: string[]}} */ (await fetchAsJSON(
          `${testnetOrigin}/network-config`,
        ));
        const genesis = await fetchAsJSON(`${testnetOrigin}/genesis.json`);

        await childProcessDone(
          pipedSpawn(
            'ag-chain-cosmos',
            ['init', '--chain-id', chainName, `loadgen-monitor-${Date.now()}`],
            { stdio },
          ),
        );

        fs.writeFile(
          joinPath(chainStateDir, 'config', 'genesis.json'),
          JSON.stringify(genesis),
        );

        await childProcessDone(
          pipedSpawn('ag-chain-cosmos', ['unsafe-reset-all'], { stdio }),
        );

        const configPath = joinPath(chainStateDir, 'config', 'config.toml');

        console.log('Patching config');
        const config = await TOML.parse.async(
          await fs.readFile(configPath, 'utf-8'),
        );
        const configP2p = /** @type {TOML.JsonMap} */ (config.p2p);
        configP2p.persistent_peers = peers.join(',');
        configP2p.seeds = seeds.join(',');
        delete config.log_level;
        await fs.writeFile(configPath, TOML.stringify(config));
      }
    }

    if (reset) {
      console.log('Resetting client');
      await childProcessDone(
        pipedSpawn('rm', ['-rf', clientStateDir], { stdio }),
      );

      // TODO: start client to provision the first time then kill it
    }

    // Make sure client is provisioned
    if (chainOnly !== true) {
      console.log('Provisioning client');

      const launcherCp = pipedSpawn(
        'agoric',
        ['start', 'testnet', '8000', `${testnetOrigin}/network-config`],
        {
          stdio,
        },
      );

      const clientDone = childProcessDone(launcherCp);

      const [clientStarted, clientProvisioned, outputParsed] = whenStreamSteps(
        launcherCp.stdout,
        [
          { matcher: clientStartRE, resultIndex: -1 },
          { matcher: clientSwingSetReadyRE, resultIndex: -1 },
        ],
        {
          waitEnd: false,
        },
      );

      Promise.allSettled([clientProvisioned, outputParsed, clientDone]);

      await aggregateTryFinally(
        async () => {
          await clientStarted;

          const processInfo = await getProcessInfo(
            /** @type {number} */ (launcherCp.pid),
          ).then((launcherInfo) =>
            getChildMatchingArgv(launcherInfo, clientArgvMatcher),
          );

          await aggregateTryFinally(
            async () =>
              tryTimeout(timeout * 1000, async () => clientProvisioned),
            async () => {
              try {
                process.kill(processInfo.pid);
              } catch (_) {
                // Ignore kill errors
              }
            },
          );

          await PromiseAllOrErrors([outputParsed, clientDone]).then(() => {});
        },
        async () => {
          launcherCp.kill();
        },
      );
    }

    await childProcessDone(pipedSpawn('agoric', ['install'], { stdio }));

    console.log('Done');
  };

  /** @param {import("./types.js").TaskBaseOptions} options */
  const runChain = async ({ stdout, stderr, timeout = 30 }) => {
    const { console, stdio } = getConsoleAndStdio('chain', stdout, stderr);

    console.log('Starting chain monitor');

    const slogFifo = await makeFIFO('chain.slog');
    const slogLines = new LineStreamTransform();
    const slogPipeResult = pipeline(slogFifo, slogLines);

    const chainEnv = Object.create(process.env);
    chainEnv.SLOGFILE = slogFifo.path;
    // chainEnv.DEBUG = 'agoric';

    const launcherCp = pipedSpawn('ag-chain-cosmos', ['start'], {
      stdio,
      env: chainEnv,
      detached: true,
    });

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

    const [swingSetLaunched, firstBlock, outputParsed] = whenStreamSteps(
      launcherCp.stdout,
      [
        { matcher: chainSwingSetLaunchRE },
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

    const ready = firstBlock.then(async () => {
      let retries = 0;
      while (!stopped) {
        // Don't pipe output to console, it's too noisy
        const statusCp = spawn('ag-chain-cosmos', ['status'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const chunks = [];
        for await (const chunk of statusCp.stdout) {
          chunks.push(chunk);
        }
        if (
          (await childProcessDone(statusCp, {
            ignoreExitCode: retries < 3,
          })) !== 0
        ) {
          retries += 1;
          await sleep(1 * 1000);
          continue; // eslint-disable-line no-continue
        } else {
          retries = 0;
        }

        const status = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

        if (status.SyncInfo.catching_up === false) {
          return;
        }

        await sleep(5 * 1000);
      }
    });

    return tryTimeout(
      timeout * 1000,
      async () => {
        await swingSetLaunched;

        console.log('Chain running');

        const stop = () => {
          stopped = true;
          launcherCp.kill();
        };

        const processInfo = await getProcessInfo(
          /** @type {number} */ (launcherCp.pid),
        );

        return harden({
          stop,
          done,
          ready,
          slogLines: {
            [Symbol.asyncIterator]: () => slogLines[Symbol.asyncIterator](),
          },
          storageLocation: chainStateDir,
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
  const runClient = async ({ stdout, stderr, timeout = 20 }) => {
    const { console, stdio } = getConsoleAndStdio('client', stdout, stderr);

    console.log('Starting client');

    const launcherCp = pipedSpawn(
      'agoric',
      ['start', 'testnet', '8000', `${testnetOrigin}/network-config`],
      {
        stdio,
        detached: true,
      },
    );

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
