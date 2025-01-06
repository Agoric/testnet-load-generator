import { join as joinPath } from 'path';

import TOML from '@iarna/toml';

import { sleep } from '../../runner/lib/helpers/async.js';
import {
  childProcessDone,
  makePrinterSpawn,
  makeSpawnWithPipedStream,
} from '../../runner/lib/helpers/child-process.js';
import { asBuffer } from '../../runner/lib/helpers/stream.js';
import {
  fetchAsJSON,
  getConsoleAndStdio,
} from '../../runner/lib/tasks/helpers.js';
import { makeGetEnvInfo } from '../../runner/lib/tasks/shared-env-info.js';

/**
 * @typedef {object} NetworkConfigRequired
 * @property {string} chainName
 * @property {string[]} peers
 * @property {string[]} rpcAddrs
 * @property {string[]} seeds
 * @property {string} gci
 *
 * @typedef {{
 *  NodeInfo: {
 *    channels: string;
 *    id: string;
 *    listen_addr: string;
 *    moniker: string;
 *    network: string;
 *    other: {
 *      rpc_address: string;
 *      tx_index: string;
 *    }
 *    protocol_version: { app: string; block: string; p2p: string; };
 *    version: string;
 *  };
 *  SyncInfo: {
 *    catching_up: boolean;
 *    earliest_app_hash: string;
 *    earliest_block_hash: string;
 *    earliest_block_height: string;
 *    earliest_block_time: string;
 *    latest_app_hash: string;
 *    latest_block_hash: string;
 *    latest_block_height: string;
 *    latest_block_time: string;
 *  };
 *  ValidatorInfo: {
 *    Address: string;
 *    PubKey: {
 *      value: string;
 *      type: string;
 *    };
 *    VotingPower: string;
 *  }
 * }} Status
 */

const APP_TOML_FILE_NAME = 'app.toml';
const ADDRESS_REGEX = /^(([a-z]+:\/\/)?[^:]+)(:[0-9]+)?$/;
const CONFIG_FOLDER_NAME = 'config';
const CONFIG_TOML_FILE_NAME = 'config.toml';
const GENESIS_FILE_NAME = 'genesis.json';

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
  const parsed = rpcAddr.match(ADDRESS_REGEX);
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
 * @param {object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {import("../../runner/lib/helpers/fs.js").MakeFIFO} powers.makeFIFO Make a FIFO file readable stream
 * @param {import("../../runner/lib/helpers/procsfs.js").GetProcessInfo} powers.getProcessInfo
 * @param {import("../../runner/lib/tasks/types.js").SDKBinaries} powers.sdkBinaries
 * @param {string | void} powers.loadgenBootstrapConfig
 */
const makeSetup = ({
  fs,
  loadgenBootstrapConfig,
  sdkBinaries,
  spawn: _spawn,
}) => {
  /** @type {Record<string, string>} */
  const additionChainEnv = {};
  const chainStateDir = String(
    process.env.AG_CHAIN_COSMOS_HOME ||
      joinPath(process.env.HOME || '~', '.ag-chain-cosmos'),
  );

  const spawn = makeSpawnWithPipedStream({
    spawn: _spawn,
    end: false,
  });

  /** @param {string} name */
  const fsExists = async (name) => {
    try {
      return !!(await fs.stat(name));
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT')
        return false;
      throw e;
    }
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
      );
      TRUSTED_BLOCK_HASH = String(trustedBlockInfo.result.block_id.hash);
    }

    return [TRUSTED_BLOCK_HASH, String(TRUSTED_BLOCK_HEIGHT)];
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
        ? { type: 'success', status: /** @type {Status}*/ (JSON.parse(output)) }
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

  /**
   * @param {object} config
   * @param {boolean} [config.reset]
   * @param {string} [config.testnetOrigin]
   * @param {boolean} [config.useStateSync]
   * @param {object} powers
   * @param {import("stream").Writable} powers.stderr
   * @param {import("stream").Writable} powers.stdout
   */
  const setupChain = async (config, { stderr, stdout }) => {
    const { reset, useStateSync, testnetOrigin: _testnetOrigin } = config;

    const testnetOrigin = _testnetOrigin || 'https://testnet.agoric.net';

    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });
    const { console, stdio } = getConsoleAndStdio(
      'setup-chain',
      stdout,
      stderr,
    );

    console.log('Starting using config: ', JSON.stringify(config || {}));

    const networkConfig = /** @type {NetworkConfigRequired} */ (
      await fetchAsJSON(`${testnetOrigin}/network-config`)
    );
    console.log('Using network config: ', networkConfig);

    const { chainName, peers, rpcAddrs, seeds, gci } = networkConfig;

    if (reset) {
      console.log('Resetting chain node');
      await childProcessDone(
        printerSpawn('rm', ['-rf', chainStateDir], { stdio }),
      );
    }

    const genesisPath = joinPath(
      chainStateDir,
      CONFIG_FOLDER_NAME,
      GENESIS_FILE_NAME,
    );

    if (!(await fsExists(genesisPath))) {
      await childProcessDone(
        printerSpawn(
          sdkBinaries.cosmosChain,
          [
            'init',
            '--chain-id',
            chainName,
            `monitoring-follower-${Date.now()}`,
          ],
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

      const appConfigPath = joinPath(
        chainStateDir,
        CONFIG_FOLDER_NAME,
        APP_TOML_FILE_NAME,
      );
      const configPath = joinPath(
        chainStateDir,
        CONFIG_FOLDER_NAME,
        CONFIG_TOML_FILE_NAME,
      );

      console.log('Patching config');
      const config = await TOML.parse.async(
        await fs.readFile(configPath, 'utf-8'),
      );

      const configP2p = /** @type {import('@iarna/toml').JsonMap} */ (
        config.p2p
      );
      const configRpc = /** @type {import('@iarna/toml').JsonMap} */ (
        config.rpc
      );

      configP2p.persistent_peers = peers.join(',');
      configP2p.seeds = seeds.join(',');
      configP2p.addr_book_strict = false;

      delete config.log_level;

      if (process.env.P2P_PORT) {
        const matches = ADDRESS_REGEX.exec(String(configP2p.laddr));
        if (matches)
          configP2p.laddr = [matches[1], ':', process.env.P2P_PORT].join('');
      }

      if (process.env.RPC_PORT) {
        const matches = ADDRESS_REGEX.exec(String(configRpc.laddr));
        if (matches)
          configRpc.laddr = [matches[1], ':', process.env.RPC_PORT].join('');
      }

      if (process.env.PPROF_PORT) {
        const matches = ADDRESS_REGEX.exec(String(configRpc.pprof_laddr));
        if (matches)
          configRpc.pprof_laddr = [
            matches[1],
            ':',
            process.env.PPROF_PORT,
          ].join('');
      }

      if (process.env.API_PORT || process.env.GRPC_PORT) {
        console.log('Patching app config');
        const appConfig = await TOML.parse.async(
          await fs.readFile(appConfigPath, 'utf-8'),
        );

        const configApi = /** @type {import('@iarna/toml').JsonMap} */ (
          appConfig.api
        );
        const configGrpc = /** @type {import('@iarna/toml').JsonMap} */ (
          appConfig.grpc
        );

        if (process.env.API_PORT) {
          const matches = ADDRESS_REGEX.exec(String(configApi.address));
          if (matches)
            configApi.address = [matches[1], ':', process.env.API_PORT].join(
              '',
            );
        }

        if (process.env.GRPC_PORT) {
          const matches = ADDRESS_REGEX.exec(String(configGrpc.address));
          if (matches)
            configGrpc.address = [matches[1], ':', process.env.GRPC_PORT].join(
              '',
            );
        }

        await fs.writeFile(appConfigPath, TOML.stringify(appConfig));
      }

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
        result.status?.SyncInfo.catching_up === false
      )
        rpcAddr = rpcAddrCandidate;
    }

    if (!rpcAddr) throw new Error('Found no suitable RPC node');

    console.log('Done');

    return chainStateDir;
  };

  return { getEnvInfo: makeGetEnvInfo({ spawn, sdkBinaries }), setupChain };
};

export default makeSetup;
