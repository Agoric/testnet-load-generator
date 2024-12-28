/* global process Buffer */
/* eslint-disable no-await-in-loop */

import { join as joinPath } from 'path';
import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';

import TOML from '@iarna/toml';
import { makePromiseKit } from '@endo/promise-kit';

import {
  getConsoleAndStdio,
  fetchAsJSON,
  cleanAsyncIterable,
  getExtraEnvArgs,
} from './helpers.js';
import { PromiseAllOrErrors, tryTimeout, sleep } from '../helpers/async.js';
import BufferLineTransform from '../helpers/buffer-line-transform.js';
import {
  childProcessDone,
  makeSpawnWithPipedStream,
  makePrinterSpawn,
  // childProcessReady,
} from '../helpers/child-process.js';
import { fsStreamReady } from '../helpers/fs.js';
import LineStreamTransform from '../helpers/line-stream-transform.js';
import {
  asBuffer,
  combineAndPipe,
  whenStreamSteps,
} from '../helpers/stream.js';
import { makeGetEnvInfo } from './shared-env-info.js';
// import { makeLoadgenTask } from './shared-loadgen.js';

const pipeline = promisify(pipelineCallback);

const stateDir = '_agstate/agoric-servers';
const profileName = 'testnet';
const CLIENT_PORT = 8000;
const clientStateDir = `${stateDir}/${profileName}-${CLIENT_PORT}`;

const VerboseDebugEnv = 'agoric,SwingSet:vat,SwingSet:ls';

const chainSwingSetLaunchRE = /launch-chain: Launching SwingSet kernel$/;
const chainBlockBeginRE = /block-manager: block (\d+) begin$/;
// const clientSwingSetReadyRE = /start: swingset running$/;
// const clientWalletReadyRE =
/(?:Deployed Wallet!|Don't need our provides: wallet)/;
const chainConsensusFailureBuffer = Buffer.from('CONSENSUS FAILURE');
const FILE_ENCODING = 'utf-8';
const KEY_NAME = 'provisioned-wallet';
const KEYRING_BACKEND = 'test';
const rpcAddrRegex = /^(?:(http|https|tcp):(?:\/\/)?)?(.*)$/;

/**
 * @param {string} rpcAddr
 * @param {object} [options]
 * @param {string} [options.withScheme]
 * @param {boolean} [options.forceScheme]
 */
const rpcAddrWithScheme = (
  rpcAddr,
  { withScheme = 'http', forceScheme = false } = {},
) => {
  const parsed = rpcAddr.match(rpcAddrRegex);
  if (!parsed) {
    throw new Error(`Couldn't parse rpcAddr ${rpcAddr}`);
  }
  const [, scheme, hierarchicalPart] = parsed;
  if (scheme && (scheme.startsWith(withScheme) || !forceScheme)) {
    return rpcAddr;
  }
  return `${withScheme}://${hierarchicalPart}`;
};

/**
 * @param {string} chainStateDir
 * @param {object} powers
 * @param {(ReturnType<typeof getConsoleAndStdio>)['console']} powers.console
 * @param {import("fs/promises")} powers.fs
 * @param {import("./types.js").SDKBinaries} powers.sdkBinaries
 * @param {(ReturnType<typeof getConsoleAndStdio>)['stdio']} powers.stdio
 * @param {ReturnType<typeof makePrinterSpawn>} powers.spawn
 */
const generateMnemonic = async (
  chainStateDir,
  { console, fs, sdkBinaries, spawn, stdio },
) => {
  const mnemonicFile = joinPath(chainStateDir, 'mnemonic');
  console.log('generating mnemonic in ', mnemonicFile);

  const mnemonicFileHandler = await fs.open(mnemonicFile, 'w');
  await childProcessDone(
    spawn(
      sdkBinaries.cosmosChain,
      [
        'keys',
        'mnemonic',
        '--home',
        chainStateDir,
        '--keyring-backend',
        KEYRING_BACKEND,
      ],
      {
        stdio: [stdio[0], mnemonicFileHandler.fd, stdio[2]],
      },
    ),
  ).finally(mnemonicFileHandler.close);

  return mnemonicFile;
};

/**
 * @param {string} chainStateDir
 * @param {Awaited<ReturnType<generateMnemonic>>} mnemonicFile
 * @param {object} powers
 * @param {(ReturnType<typeof getConsoleAndStdio>)['console']} powers.console
 * @param {import("fs/promises")} powers.fs
 * @param {import("./types.js").SDKBinaries} powers.sdkBinaries
 * @param {(ReturnType<typeof getConsoleAndStdio>)['stdio']} powers.stdio
 * @param {ReturnType<typeof makePrinterSpawn>} powers.spawn
 */
const generateWalletFromMnemonic = async (
  chainStateDir,
  mnemonicFile,
  { console, fs, sdkBinaries, spawn, stdio },
) => {
  const addressFile = joinPath(chainStateDir, 'address');

  const mnemonicFileHandler = await fs.open(mnemonicFile, 'r');

  const cp = spawn(
    sdkBinaries.cosmosChain,
    [
      'keys',
      'add',
      KEY_NAME,
      '--home',
      chainStateDir,
      '--keyring-backend',
      KEYRING_BACKEND,
      '--output',
      'json',
      '--recover',
    ],
    {
      stdio: [mnemonicFileHandler.fd, 'pipe', 'pipe'],
    },
  );

  const lines = new LineStreamTransform();

  // @ts-expect-error
  combineAndPipe(cp.stdio, stdio).pipe(lines);

  let output = '';

  for await (const line of lines) output += line;

  await childProcessDone(cp).finally(mnemonicFileHandler.close);

  console.log('Writing address to ', addressFile);
  await fs.writeFile(addressFile, JSON.parse(output).address, {
    encoding: FILE_ENCODING,
  });

  return addressFile;
};

/**
 * @param {string} rpcAddress
 */
const getTrustedBlockData = async (rpcAddress) => {
  let { TRUSTED_BLOCK_HASH, TRUSTED_BLOCK_HEIGHT } = process.env;

  if (!TRUSTED_BLOCK_HASH) {
    if (!TRUSTED_BLOCK_HEIGHT) {
      /** @type {any} */
      const currentBlockInfo = await fetchAsJSON(
        `${rpcAddrWithScheme(rpcAddress, { forceScheme: true })}/block`,
        { retries: 10 },
      );
      const stateSyncInterval =
        Number(process.env.AG_SETUP_COSMOS_STATE_SYNC_INTERVAL) || 2000;
      TRUSTED_BLOCK_HEIGHT = String(
        Math.max(
          1,
          Number(currentBlockInfo.result.block.header.height) -
            stateSyncInterval,
        ),
      );
    }

    /** @type {any} */
    const trustedBlockInfo = await fetchAsJSON(
      `${rpcAddrWithScheme(rpcAddress, {
        forceScheme: true,
      })}/block?height=${TRUSTED_BLOCK_HEIGHT}`,
      { retries: 10 },
    );
    TRUSTED_BLOCK_HASH = String(trustedBlockInfo.result.block_id.hash);
  }

  return [TRUSTED_BLOCK_HASH, String(TRUSTED_BLOCK_HEIGHT)];
};

/**
 *
 * @param {object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {import("../helpers/fs.js").MakeFIFO} powers.makeFIFO Make a FIFO file readable stream
 * @param {import("../helpers/procsfs.js").GetProcessInfo} powers.getProcessInfo
 * @param {import("./types.js").SDKBinaries} powers.sdkBinaries
 * @param {string | void} powers.loadgenBootstrapConfig
 * @returns {import("./types.js").OrchestratorTasks}
 */
export const makeTasks = ({
  spawn: cpSpawn,
  fs,
  makeFIFO,
  getProcessInfo,
  sdkBinaries,
  loadgenBootstrapConfig,
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

  /**
   * @param {object} powers
   * @param {ReturnType<typeof makePrinterSpawn>} powers.spawn
   * @param {string} [rpcAddr]
   * @param {number} [retries]
   */
  const queryNodeStatus = async ({ spawn }, rpcAddr, retries = 1) => {
    const args = ['status'];

    if (rpcAddr)
      args.push(`--node=${rpcAddrWithScheme(rpcAddr, { withScheme: 'tcp' })}`);

    const runQuery = async () => {
      // Don't pipe output to console, it's too noisy
      const statusCp = spawn(sdkBinaries.cosmosChain, args, {
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

    let response = null;

    while (retries) {
      response = await runQuery();
      if (response.type === 'success') return response;
      else {
        retries -= 1;
        await sleep(2000);
      }
    }

    return /** @type {ReturnType<typeof runQuery>} */ (
      /** @type {unknown} */ (response)
    );
  };

  const chainStateDir = String(
    process.env.AG_CHAIN_COSMOS_HOME ||
      joinPath(process.env.HOME || '~', '.ag-chain-cosmos'),
  );

  let testnetOrigin = 'https://testnet.agoric.net';

  /** @type {Record<string, string>} */
  const additionChainEnv = {};

  /** @param {import("./types.js").TaskBaseOptions & {config?: {reset?: boolean, chainOnly?: boolean, withMonitor?: boolean, testnetOrigin?: string, useStateSync?: boolean}}} options */
  const setupTasks = async ({
    stdout,
    stderr,
    timeout = 10 * 60,
    orInterrupt = async (job) => job,
    config: {
      reset = true,
      // chainOnly,
      // withMonitor = true,
      testnetOrigin: testnetOriginOption,
      useStateSync,
    } = {},
    config,
  }) => {
    const { console, stdio } = getConsoleAndStdio(
      'setup-tasks',
      stdout,
      stderr,
    );

    console.log('Starting using config: ', JSON.stringify(config || {}));

    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    /** @type {Partial<Record<'chainStorageLocation' | 'clientStorageLocation', string>>} */
    const storageLocations = {};

    testnetOrigin = testnetOriginOption || testnetOrigin;

    /**
     * @typedef {object} NetworkConfigRequired
     * @property {string} chainName
     * @property {string[]} peers
     * @property {string[]} rpcAddrs
     * @property {string[]} seeds
     * @property {string} gci
     */

    /**
     * @type {NetworkConfigRequired}
     */
    let networkConfig = process.env.NETWORK_CONFIG
      ? JSON.parse(process.env.NETWORK_CONFIG)
      : {};
    if (!networkConfig) {
      console.log('Fetching network config');

      networkConfig = /** @type {NetworkConfigRequired} */ (
        await fetchAsJSON(`${testnetOrigin}/network-config`)
      );
    }
    console.log('Using network config: ', networkConfig);

    const { chainName, peers, rpcAddrs, seeds, gci } = networkConfig;

    // if (withMonitor !== false) {
    storageLocations.chainStorageLocation = chainStateDir;

    if (reset) {
      console.log('Resetting chain node');
      await childProcessDone(
        printerSpawn('rm', ['-rf', chainStateDir], { stdio }),
      );
    }

    const genesisPath = joinPath(chainStateDir, 'config', 'genesis.json');

    if (!(await fsExists(genesisPath))) {
      await childProcessDone(
        printerSpawn(
          sdkBinaries.cosmosChain,
          ['init', '--chain-id', chainName, `loadgen-monitor-${Date.now()}`],
          { stdio },
        ),
      );

      await childProcessDone(
        printerSpawn(
          sdkBinaries.cosmosChain,
          ['tendermint', 'unsafe-reset-all'],
          {
            stdio,
          },
        ),
      ).catch(() =>
        childProcessDone(
          printerSpawn(sdkBinaries.cosmosChain, ['unsafe-reset-all'], {
            stdio,
          }),
        ),
      );

      const configPath = joinPath(chainStateDir, 'config', 'config.toml');

      console.log('Patching config');
      const config = await TOML.parse.async(
        await fs.readFile(configPath, 'utf-8'),
      );
      const configP2p = /** @type {import('@iarna/toml').JsonMap} */ (
        config.p2p
      );
      configP2p.persistent_peers = peers.join(',');
      configP2p.seeds = seeds.join(',');
      configP2p.addr_book_strict = false;
      delete config.log_level;

      if (!useStateSync) {
        console.log('Fetching genesis');
        const gciResult = await fetchAsJSON(gci);
        const { genesis } = /** @type {*} */ (gciResult).result;

        fs.writeFile(
          joinPath(chainStateDir, 'config', 'genesis.json'),
          JSON.stringify(genesis),
        );
      } else {
        console.log('Fetching state-sync info');
        const [trustHash, trustHeight] = await getTrustedBlockData(rpcAddrs[0]);

        const stateSyncRpc =
          rpcAddrs.length < 2 ? [rpcAddrs[0], rpcAddrs[0]] : rpcAddrs;

        const configStatesync = /** @type {import('@iarna/toml').JsonMap} */ (
          config.statesync
        );
        configStatesync.enable = true;
        configStatesync.rpc_servers = stateSyncRpc
          .map((rpcAddr) => rpcAddrWithScheme(rpcAddr))
          .join(',');
        configStatesync.trust_height = trustHeight;
        configStatesync.trust_hash = trustHash;
      }

      await fs.writeFile(configPath, TOML.stringify(config));
    }

    if (loadgenBootstrapConfig)
      additionChainEnv.CHAIN_BOOTSTRAP_VAT_CONFIG = loadgenBootstrapConfig;
    // }

    // if (chainOnly !== true) {
    storageLocations.clientStorageLocation = clientStateDir;

    // if (reset) {
    //   console.log('Resetting client');
    //   await childProcessDone(
    //     printerSpawn('rm', ['-rf', clientStateDir], { stdio }),
    //   );
    // }

    console.log('Provisioning client');

    // const netConfig = `${testnetOrigin}/network-config`;

    //   // Initialize the solo directory and key.
    //   if (!(await fsExists(clientStateDir))) {
    //     await childProcessDone(
    //       printerSpawn(
    //         sdkBinaries.agSolo,
    //         [
    //           'init',
    //           clientStateDir,
    //           `--webport=${CLIENT_PORT}`,
    //           `--netconfig=${netConfig}`,
    //         ],
    //         {
    //           stdio,
    //         },
    //       ),
    //     );
    //   }
    // await childProcessDone(
    //   printerSpawn(sdkBinaries.agSolo, ['add-chain', netConfig], {
    //     stdio,
    //     cwd: clientStateDir,
    //   }),
    // );

    // const soloAddr = (
    //   await fs.readFile(`${clientStateDir}/ag-cosmos-helper-address`, 'utf-8')
    // ).trimEnd();

    const provisionedAddress = (
      await fs.readFile(
        await generateWalletFromMnemonic(
          chainStateDir,
          await generateMnemonic(chainStateDir, {
            console,
            fs,
            sdkBinaries,
            spawn: printerSpawn,
            stdio,
          }),
          {
            console,
            fs,
            sdkBinaries,
            spawn: printerSpawn,
            stdio,
          },
        ),
        FILE_ENCODING,
      )
    ).trimEnd();

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

      const result = await queryNodeStatus(
        { spawn: printerSpawn },
        rpcAddrCandidate,
        10,
      );

      if (
        result.type === 'success' &&
        result.status.SyncInfo.catching_up === false
      )
        rpcAddr = rpcAddrCandidate;
    }

    if (!rpcAddr) throw new Error('Found no suitable RPC node');

    /**
     * @param {number} [checks]
     * @returns {Promise<void>}
     */
    //     const untilProvisioned = async (checks = 0) => {
    //       const checkAddrStatus = await childProcessDone(
    //         printerSpawn(
    //           sdkBinaries.cosmosChain,
    //           [
    //             'query',
    //             'swingset',
    //             'egress',
    //             provisionedAddress,
    //             `--chain-id "${chainName}"`,
    //             `--home "${chainStateDir}"`,
    //             `--node "${rpcAddrWithScheme(rpcAddr, { withScheme: 'tcp' })}"`,
    //           ],
    //           { stdio: 'ignore' },
    //         ),
    //         { ignoreExitCode: true },
    //       );

    //       if (checkAddrStatus === 0) return undefined;

    //       if (!checks)
    //         console.error(`
    // =============
    // ${chainName} chain does not yet know of address ${provisionedAddress}
    // =============
    //               `);

    //       await orInterrupt(sleep(6 * 1000));

    //       return untilProvisioned(checks + 1);
    //     };

    // await tryTimeout(timeout * 1000, untilProvisioned);

    // TODO: Figure out how to plumb address of other loadgen client
    if (provisionedAddress)
      additionChainEnv.VAULT_FACTORY_CONTROLLER_ADDR = provisionedAddress;

    console.log('Done');

    return harden(storageLocations);
  };

  /** @param {import("./types.js").TaskSwingSetOptions} options */
  const runChain = async ({ stdout, stderr, timeout = 300, trace }) => {
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

    const { env: traceEnv, args: traceArgs } = getExtraEnvArgs({ trace });

    const chainEnv = Object.assign(Object.create(process.env), {
      ...additionChainEnv,
      ...traceEnv,
      SLOGFILE: slogFifo.path,
      // Comment out if running against an older chain which doesn't have debug enabled
      // That's because previously any DEBUG env set changed the way vats processed console
      // logs, which caused divergences with other nodes
      // See https://github.com/Agoric/agoric-sdk/issues/4506
      DEBUG: VerboseDebugEnv,
    });

    const chainCp = printerSpawn(
      sdkBinaries.cosmosChain,
      ['start', ...traceArgs],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: chainEnv,
        detached: true,
      },
    );

    let stopped = false;
    /** @type {{signal: undefined | 'SIGTERM' | 'SIGINT'}} */
    const ignoreKill = {
      signal: undefined,
    };

    const chainDone = childProcessDone(chainCp, {
      ignoreKill,
      killedExitCode: 98,
    });

    const stop = () => {
      if (!stopped) {
        stopped = true;
        ignoreKill.signal = 'SIGINT';
        chainCp.kill(ignoreKill.signal);
      }
    };

    chainDone
      .then(
        () => console.log('Chain exited successfully'),
        (error) => console.error('Chain exited with error', error),
      )
      .finally(() => {
        stopped = true;
        if (slogFifo.pending) {
          slogLines.end();
          slogFifo.close();
        }
      });

    const chainCombinedElidedOutput = combineAndPipe(chainCp.stdio, stdio);
    const [swingSetLaunched, firstBlock, outputParsed] = whenStreamSteps(
      chainCombinedElidedOutput,
      [
        { matcher: chainSwingSetLaunchRE },
        { matcher: chainBlockBeginRE, resultIndex: -1 },
      ],
      {
        waitEnd: false,
        close: false,
      },
    );

    /** @type {import('@endo/promise-kit').PromiseRecord<void>} */
    const doneKit = makePromiseKit();
    const done = doneKit.promise;

    PromiseAllOrErrors([slogPipeResult, outputParsed, chainDone]).then(() =>
      doneKit.resolve(),
    );

    outputParsed.then(async () => {
      for await (const line of /** @type {AsyncIterable<Buffer>} */ (
        chainCombinedElidedOutput
      )) {
        if (line.subarray(0, 100).includes(chainConsensusFailureBuffer)) {
          doneKit.reject(new Error('Consensus Failure'));
          chainCombinedElidedOutput.destroy();
          stop();
          return;
        }
      }
    });

    const ready = PromiseAllOrErrors([firstBlock, slogReady]).then(async () => {
      let retries = 0;
      while (!stopped) {
        const result = await queryNodeStatus({ spawn: printerSpawn });

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

      // Rethrow any error if stopped before ready
      await chainDone;
    });

    return tryTimeout(
      timeout * 1000,
      async () => {
        await swingSetLaunched;

        console.log('Chain running');

        const processInfo = await getProcessInfo(
          /** @type {number} */ (chainCp.pid),
        ).catch(() => undefined);

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
        chainCp.kill();
        slogFifo.close();
        await Promise.allSettled([done, ready]);
      },
    );
  };

  // /** @param {import("./types.js").TaskSwingSetOptions} options */
  // const runClient = async ({ stdout, stderr, timeout = 180, trace }) => {
  //   const { console, stdio } = getConsoleAndStdio('client', stdout, stderr);
  //   const printerSpawn = makePrinterSpawn({
  //     spawn,
  //     print: (cmd) => console.log(cmd),
  //   });

  //   console.log('Starting client');

  //   const slogFifo = await makeFIFO('client.slog');
  //   const slogReady = fsStreamReady(slogFifo);
  //   const slogLines = new BufferLineTransform();
  //   const slogPipeResult = slogReady.then(() =>
  //     slogLines.writableEnded ? undefined : pipeline(slogFifo, slogLines),
  //   );

  //   const { env: traceEnv } = getExtraEnvArgs({ trace }, 'SOLO_');

  //   const clientEnv = Object.assign(Object.create(process.env), {
  //     ...traceEnv,
  //     SOLO_SLOGFILE: slogFifo.path,
  //     DEBUG: VerboseDebugEnv,
  //   });

  //   const soloCp = printerSpawn(sdkBinaries.agSolo, ['start'], {
  //     stdio: ['ignore', 'pipe', 'pipe'],
  //     cwd: clientStateDir,
  //     env: clientEnv,
  //     detached: true,
  //   });

  //   /** @type {{signal: undefined | 'SIGTERM'}} */
  //   const ignoreKill = {
  //     signal: undefined,
  //   };

  //   const soloCpReady = childProcessReady(soloCp);
  //   const clientDone = childProcessDone(soloCp, {
  //     ignoreKill,
  //     killedExitCode: 98,
  //   });

  //   clientDone
  //     .then(
  //       () => console.log('Client exited successfully'),
  //       (error) => console.error('Client exited with error', error),
  //     )
  //     .finally(() => {
  //       if (slogFifo.pending) {
  //         slogLines.end();
  //         slogFifo.close();
  //       }
  //     });

  //   const soloCombinedElidedOutput = combineAndPipe(soloCp.stdio, stdio);
  //   const [clientStarted, walletReady, outputParsed] = whenStreamSteps(
  //     soloCombinedElidedOutput,
  //     [
  //       { matcher: clientSwingSetReadyRE, resultIndex: -1 },
  //       { matcher: clientWalletReadyRE, resultIndex: -1 },
  //     ],
  //     {
  //       waitEnd: false,
  //     },
  //   );

  //   const done = PromiseAllOrErrors([
  //     slogPipeResult,
  //     outputParsed,
  //     clientDone,
  //   ]).then(() => {});

  //   walletReady
  //     .then(() =>
  //       Promise.race([
  //         slogReady,
  //         Promise.reject(new Error('Slog not supported')),
  //       ]),
  //     )
  //     .catch((err) => console.warn(err.message || err));

  //   return tryTimeout(
  //     timeout * 1000,
  //     async () => {
  //       await soloCpReady;
  //       await clientStarted;

  //       console.log('Client running');

  //       const processInfo = await getProcessInfo(
  //         /** @type {number} */ (soloCp.pid),
  //       ).catch(() => undefined);

  //       const stop = () => {
  //         ignoreKill.signal = 'SIGTERM';
  //         soloCp.kill(ignoreKill.signal);
  //       };

  //       return harden({
  //         stop,
  //         done,
  //         ready: walletReady,
  //         slogLines: cleanAsyncIterable(slogLines),
  //         storageLocation: clientStateDir,
  //         processInfo,
  //       });
  //     },
  //     async () => {
  //       soloCp.kill();
  //       slogFifo.close();
  //       await Promise.allSettled([done, clientStarted, walletReady]);
  //     },
  //   );
  // };

  return harden({
    getEnvInfo: makeGetEnvInfo({ spawn, sdkBinaries }),
    setupTasks,
    runChain,
    // runClient,
    // runLoadgen: makeLoadgenTask({ spawn }),
  });
};
