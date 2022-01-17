/* global process */
/* eslint-disable no-await-in-loop */

import { join as joinPath } from 'path';
import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';

import TOML from '@iarna/toml';

import {
  childProcessDone,
  makeSpawnWithPipedStream,
  makePrinterSpawn,
  childProcessReady,
} from '../helpers/child-process.js';
import BufferLineTransform from '../helpers/buffer-line-transform.js';
import { PromiseAllOrErrors, tryTimeout, sleep } from '../helpers/async.js';
import { fsStreamReady } from '../helpers/fs.js';
import { asBuffer, whenStreamSteps } from '../helpers/stream.js';
import {
  getConsoleAndStdio,
  fetchAsJSON,
  cleanAsyncIterable,
} from './helpers.js';
import { makeGetEnvInfo } from './shared-env-info.js';
import { makeLoadgenTask } from './shared-loadgen.js';

const pipeline = promisify(pipelineCallback);

const stateDir = '_agstate/agoric-servers';
const profileName = 'testnet';
const CLIENT_PORT = 8000;
const clientStateDir = `${stateDir}/${profileName}-${CLIENT_PORT}`;

const chainSwingSetLaunchRE = /launch-chain: Launching SwingSet kernel$/;
const chainBlockBeginRE = /block-manager: block (\d+) begin$/;
const clientSwingSetReadyRE = /start: swingset running$/;
const clientWalletReadyRE = /(?:Deployed Wallet!|Don't need our provides: wallet)/;

/**
 *
 * @param {Object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {import("../helpers/fs.js").MakeFIFO} powers.makeFIFO Make a FIFO file readable stream
 * @param {import("../helpers/procsfs.js").GetProcessInfo} powers.getProcessInfo
 * @param {import("./types.js").SDKBinaries} powers.sdkBinaries
 * @returns {import("./types.js").OrchestratorTasks}
 *
 */
export const makeTasks = ({
  spawn: cpSpawn,
  fs,
  makeFIFO,
  getProcessInfo,
  sdkBinaries,
}) => {
  const spawn = makeSpawnWithPipedStream({
    spawn: cpSpawn,
    end: false,
  });

  /** @param {string} name */
  const fsExists = async (name) => {
    try {
      await fs.stat(name);
      return true;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') {
        return false;
      }
      throw e;
    }
  };

  /** @param {string} [rpcAddr] */
  const queryNodeStatus = async (rpcAddr) => {
    const args = ['status'];

    if (rpcAddr) {
      args.push(`--node=tcp://${rpcAddr}`);
    }

    // Don't pipe output to console, it's too noisy
    const statusCp = spawn(sdkBinaries.cosmosHelper, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pres = asBuffer(statusCp.stdout);
    const retCode = await childProcessDone(statusCp, {
      ignoreExitCode: true,
    });

    const output = (await pres).toString('utf-8');

    return retCode === 0
      ? { type: 'success', status: JSON.parse(output) }
      : {
          type: 'error',
          code: retCode,
          output,
          error: (await asBuffer(statusCp.stderr)).toString('utf-8'),
        };
  };

  const chainStateDir = String(
    process.env.AG_CHAIN_COSMOS_HOME ||
      joinPath(process.env.HOME || '~', '.ag-chain-cosmos'),
  );

  let testnetOrigin = 'https://testnet.agoric.net';

  /** @param {import("./types.js").TaskBaseOptions & {config?: {reset?: boolean, chainOnly?: boolean, withMonitor?: boolean, testnetOrigin?: string}}} options */
  const setupTasks = async ({
    stdout,
    stderr,
    timeout = 10 * 60,
    orInterrupt = async (job) => job,
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
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting');

    if (testnetOriginOption) {
      testnetOrigin = testnetOriginOption;
    }

    console.log('Fetching network config');
    // eslint-disable-next-line jsdoc/check-alignment
    const { chainName, peers, rpcAddrs, seeds } = /** @type {{
     *   chainName: string,
     *   peers: string[],
     *   rpcAddrs: string[],
     *   seeds: string[]
     * } & Record<string, unknown>}
     */ (await fetchAsJSON(`${testnetOrigin}/network-config`));

    if (withMonitor !== false) {
      if (reset) {
        console.log('Resetting chain node');
        await childProcessDone(
          printerSpawn('rm', ['-rf', chainStateDir], { stdio }),
        );
      }

      const genesisPath = joinPath(chainStateDir, 'config', 'genesis.json');

      if (!(await fsExists(genesisPath))) {
        console.log('Fetching genesis');
        const genesis = await fetchAsJSON(`${testnetOrigin}/genesis.json`);

        await childProcessDone(
          printerSpawn(
            sdkBinaries.cosmosChain,
            ['init', '--chain-id', chainName, `loadgen-monitor-${Date.now()}`],
            { stdio },
          ),
        );

        fs.writeFile(
          joinPath(chainStateDir, 'config', 'genesis.json'),
          JSON.stringify(genesis),
        );

        await childProcessDone(
          printerSpawn(sdkBinaries.cosmosChain, ['unsafe-reset-all'], {
            stdio,
          }),
        );

        const configPath = joinPath(chainStateDir, 'config', 'config.toml');

        console.log('Patching config');
        const config = await TOML.parse.async(
          await fs.readFile(configPath, 'utf-8'),
        );
        const configP2p = /** @type {TOML.JsonMap} */ (config.p2p);
        configP2p.persistent_peers = peers.join(',');
        configP2p.seeds = seeds.join(',');
        configP2p.addr_book_strict = false;
        delete config.log_level;
        await fs.writeFile(configPath, TOML.stringify(config));
      }
    }

    // Make sure client is provisioned
    if (chainOnly !== true) {
      if (reset) {
        console.log('Resetting client');
        await childProcessDone(
          printerSpawn('rm', ['-rf', clientStateDir], { stdio }),
        );
      }

      console.log('Provisioning client');

      const netConfig = `${testnetOrigin}/network-config`;

      // Initialize the solo directory and key.
      if (!(await fsExists(clientStateDir))) {
        await childProcessDone(
          printerSpawn(
            sdkBinaries.agSolo,
            [
              'init',
              clientStateDir,
              `--webport=${CLIENT_PORT}`,
              `--netconfig=${netConfig}`,
            ],
            {
              stdio,
            },
          ),
        );
      }

      await childProcessDone(
        printerSpawn(sdkBinaries.agSolo, ['add-chain', netConfig], {
          stdio,
          cwd: clientStateDir,
        }),
      );

      const soloAddr = (
        await fs.readFile(`${clientStateDir}/ag-cosmos-helper-address`, 'utf-8')
      ).trimRight();

      const rpcAddrCandidates = [...rpcAddrs];
      let rpcAddr;

      while (!rpcAddr && rpcAddrCandidates.length) {
        const pseudoRandom =
          rpcAddrCandidates
            .join('')
            .split('')
            .reduce((acc, val) => acc + val.charCodeAt(0), 0) %
          rpcAddrCandidates.length;
        const rpcAddrCandidate = rpcAddrCandidates.splice(pseudoRandom, 1)[0];

        const result = await queryNodeStatus(rpcAddrCandidate);

        if (
          result.type === 'success' &&
          result.status.SyncInfo.catching_up === false
        ) {
          rpcAddr = rpcAddrCandidate;
        }
      }

      if (!rpcAddr) {
        throw new Error('Found no suitable RPC node');
      }

      const keysSharedArgs = [
        '--log_level=info',
        `--chain-id=${chainName}`,
        `--node=tcp://${rpcAddr}`,
      ];

      /**
       * @param {number} [checks]
       * @returns {Promise<void>}
       */
      const untilProvisioned = async (checks = 0) => {
        const checkAddrStatus = await childProcessDone(
          spawn(
            sdkBinaries.cosmosHelper,
            [
              `--home=${joinPath(clientStateDir, 'ag-cosmos-helper-statedir')}`,
              ...keysSharedArgs,
              'query',
              'swingset',
              'egress',
              '--',
              soloAddr,
            ],
            { stdio: 'ignore' },
          ),
          { ignoreExitCode: true },
        );

        if (checkAddrStatus === 0) {
          return undefined;
        }

        if (!checks) {
          console.error(`
=============
${chainName} chain does not yet know of address ${soloAddr}
=============
          `);
        }

        await orInterrupt(sleep(6 * 1000));

        return untilProvisioned(checks + 1);
      };

      await tryTimeout(timeout * 1000, untilProvisioned);
    }

    await childProcessDone(printerSpawn('agoric', ['install'], { stdio }));

    console.log('Done');
  };

  /** @param {import("./types.js").TaskBaseOptions} options */
  const runChain = async ({ stdout, stderr, timeout = 30 }) => {
    const { console, stdio } = getConsoleAndStdio('chain', stdout, stderr);
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting chain monitor');

    const slogFifo = await makeFIFO('chain.slog');
    const slogReady = fsStreamReady(slogFifo);
    const slogLines = new BufferLineTransform();
    const slogPipeResult = pipeline(slogFifo, slogLines);

    const chainEnv = Object.create(process.env);
    chainEnv.SLOGFILE = slogFifo.path;
    // chainEnv.DEBUG = 'agoric';

    const chainCp = printerSpawn(sdkBinaries.cosmosChain, ['start'], {
      stdio: ['ignore', 'pipe', stdio[2]],
      env: chainEnv,
      detached: true,
    });

    let stopped = false;

    // Chain exit with code 98 when killed
    const chainDone = childProcessDone(chainCp, {
      ignoreExitCode: true,
    }).then((code) => {
      if (code !== 0 && (!stopped || code !== 98)) {
        return Promise.reject(
          new Error(`Chain exited with non-zero code: ${code}`),
        );
      }
      return 0;
    });

    chainDone
      .then(
        () => console.log('Chain exited successfully'),
        (error) => console.error('Chain exited with error', error),
      )
      .finally(() => {
        if (slogFifo.pending) {
          slogLines.end();
          slogFifo.close();
        }
      });

    chainCp.stdout.pipe(stdio[1], { end: false });
    const [swingSetLaunched, firstBlock, outputParsed] = whenStreamSteps(
      chainCp.stdout,
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

    const ready = PromiseAllOrErrors([firstBlock, slogReady]).then(async () => {
      let retries = 0;
      while (!stopped) {
        const result = await queryNodeStatus();

        if (result.type === 'error') {
          if (retries >= 10) {
            console.error(
              'Failed to query chain status.\n',
              result.output,
              result.error,
            );
            throw new Error(
              `Process exited with non-zero code: ${result.code}`,
            );
          }

          retries += 1;
          await sleep(retries * 1000);
        } else {
          retries = 0;

          if (result.status.SyncInfo.catching_up === false) {
            return;
          }

          await sleep(5 * 1000);
        }
      }
    });

    return tryTimeout(
      timeout * 1000,
      async () => {
        await swingSetLaunched;

        console.log('Chain running');

        const processInfo = await getProcessInfo(
          /** @type {number} */ (chainCp.pid),
        );

        const stop = () => {
          stopped = true;
          chainCp.kill();
        };

        return harden({
          stop,
          done,
          ready,
          slogLines: cleanAsyncIterable(slogLines),
          storageLocation: chainStateDir,
          processInfo,
        });
      },
      async () => {
        // Avoid unhandled rejections for promises that can no longer be handled
        Promise.allSettled([done, ready]);
        chainCp.kill();
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

    const slogFifo = await makeFIFO('client.slog');
    const slogReady = fsStreamReady(slogFifo);
    const slogLines = new BufferLineTransform();
    const slogPipeResult = pipeline(slogFifo, slogLines);

    const clientEnv = Object.create(process.env);
    clientEnv.SOLO_SLOGFILE = slogFifo.path;

    const soloCp = printerSpawn(sdkBinaries.agSolo, ['start'], {
      stdio: ['ignore', 'pipe', stdio[2]],
      cwd: clientStateDir,
      env: clientEnv,
      detached: true,
    });

    /** @type {{signal: undefined | 'SIGTERM'}} */
    const ignoreKill = {
      signal: undefined,
    };

    const soloCpReady = childProcessReady(soloCp);
    const clientDone = childProcessDone(soloCp, { ignoreKill });

    clientDone
      .then(
        () => console.log('Client exited successfully'),
        (error) => console.error('Client exited with error', error),
      )
      .finally(() => {
        if (slogFifo.pending) {
          slogLines.end();
          slogFifo.close();
        }
      });

    soloCp.stdout.pipe(stdio[1], { end: false });
    const [clientStarted, walletReady, outputParsed] = whenStreamSteps(
      soloCp.stdout,
      [
        { matcher: clientSwingSetReadyRE, resultIndex: -1 },
        { matcher: clientWalletReadyRE, resultIndex: -1 },
      ],
      {
        waitEnd: false,
      },
    );

    const done = PromiseAllOrErrors([
      slogPipeResult,
      outputParsed,
      clientDone,
    ]).then(() => {});

    const ready = PromiseAllOrErrors([walletReady, slogReady]).then(() => {});

    return tryTimeout(
      timeout * 1000,
      async () => {
        await soloCpReady;
        await clientStarted;

        console.log('Client running');

        const processInfo = await getProcessInfo(
          /** @type {number} */ (soloCp.pid),
        );

        const stop = () => {
          ignoreKill.signal = 'SIGTERM';
          soloCp.kill(ignoreKill.signal);
        };

        return harden({
          stop,
          done,
          ready,
          slogLines: cleanAsyncIterable(slogLines),
          storageLocation: clientStateDir,
          processInfo,
        });
      },
      async () => {
        // Avoid unhandled rejections for promises that can no longer be handled
        Promise.allSettled([done, clientStarted, walletReady]);
        soloCp.kill();
        slogFifo.close();
      },
    );
  };

  return harden({
    getEnvInfo: makeGetEnvInfo({ spawn, sdkBinaries }),
    setupTasks,
    runChain,
    runClient,
    runLoadgen: makeLoadgenTask({ spawn }),
  });
};
