/* global process */

import { join as joinPath } from 'path';
import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';

import {
  childProcessDone,
  makeSpawnWithPipedStream,
  makePrinterSpawn,
  childProcessReady,
} from '../helpers/child-process.js';
import BufferLineTransform from '../helpers/buffer-line-transform.js';
import { PromiseAllOrErrors, tryTimeout } from '../helpers/async.js';
import { fsStreamReady } from '../helpers/fs.js';
import {
  asBuffer,
  combineAndPipe,
  whenStreamSteps,
} from '../helpers/stream.js';
import {
  getArgvMatcher,
  getChildMatchingArgv,
  wrapArgvMatcherIgnoreEnvShebang,
  getConsoleAndStdio,
  cleanAsyncIterable,
  getExtraEnvArgs,
  wrapArgvMatcherIgnoreDashDash,
} from './helpers.js';
import { makeGetEnvInfo } from './shared-env-info.js';
import { makeLoadgenTask } from './shared-loadgen.js';

const pipeline = promisify(pipelineCallback);

const stateDir = '_agstate/agoric-servers';
const keysDir = '_agstate/keys';
const profileName = 'local-chain';
const CLIENT_PORT = 8000;
const CHAIN_PORT = 26657;
const clientStateDir = `${stateDir}/${'local-solo'}-${CLIENT_PORT}`;
const chainStateDir = `${stateDir}/${profileName}-${CHAIN_PORT}`;
const CHAIN_ID = 'agoric';
const GAS_ADJUSTMENT = '1.2';
const CENTRAL_DENOM = 'urun';
const STAKING_DENOM = 'ubld';
// Need to provision less than 50000 RUN as that's the most we can get from an old sdk genesis
const SOLO_COINS = `75000000${STAKING_DENOM},40000000000${CENTRAL_DENOM}`;

const VerboseDebugEnv = 'agoric,SwingSet:vat,SwingSet:ls';

const chainStartRE = /ag-chain-cosmos start --home=(.*)$/;
const chainSwingSetLaunchRE = /launch-chain: Launching SwingSet kernel$/;
const chainBlockBeginRE = /block-manager: block (\d+) begin$/;
const clientSwingSetReadyRE = /start: swingset running$/;
const clientWalletReadyRE =
  /(?:Deployed Wallet!|Don't need our provides: wallet)/;

const chainNodeArgvMatcher = wrapArgvMatcherIgnoreEnvShebang(
  getArgvMatcher([/node$/, /chain-entrypoint/]),
);
const chainGoArgvMatcher = getArgvMatcher([/(?:sh|node)$/, /ag-chain-cosmos$/]);
/** @param {string[]} argv */
const chainArgvMatcher = (argv) =>
  chainNodeArgvMatcher(argv) || chainGoArgvMatcher(argv);

/**
 *
 * @param {Object} powers
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

  /** @type {Record<string, string>} */
  const additionChainEnv = {};

  /** @param {import("./types.js").TaskBaseOptions & {config?: {reset?: boolean, chainOnly?: boolean, withMonitor?: boolean}}} options */
  const setupTasks = async ({
    stdout,
    stderr,
    config: { reset, chainOnly, withMonitor } = {},
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

    /** @type {Partial<Record<'chainStorageLocation' | 'clientStorageLocation', string>>} */
    const storageLocations = {};

    console.log('Starting');

    if (chainOnly !== true) {
      storageLocations.clientStorageLocation = clientStateDir;

      if (reset) {
        console.log('Resetting client state');
        await childProcessDone(
          printerSpawn('rm', ['-rf', clientStateDir], { stdio }),
        );
      }

      // Initialize the solo directory and key.
      if (!(await fsExists(clientStateDir))) {
        await childProcessDone(
          printerSpawn(
            sdkBinaries.agSolo,
            ['init', clientStateDir, `--webport=${CLIENT_PORT}`],
            {
              stdio,
            },
          ),
        );
      }
    }

    if (withMonitor !== false) {
      storageLocations.chainStorageLocation = chainStateDir;

      if (reset) {
        console.log('Resetting chain node');
        await childProcessDone(
          printerSpawn('rm', ['-rf', chainStateDir], { stdio }),
        );
      }

      const configDir = joinPath(chainStateDir, 'config');
      const genesisPath = joinPath(configDir, 'genesis.json');
      const soloAddrPath = joinPath(clientStateDir, 'ag-cosmos-helper-address');

      if (!(await fsExists(genesisPath))) {
        console.log('Provisioning chain');

        if (loadgenBootstrapConfig && (await fsExists(soloAddrPath))) {
          const soloAddr = (await fs.readFile(soloAddrPath, 'utf-8')).trimEnd();
          additionChainEnv.VAULT_FACTORY_CONTROLLER_ADDR = soloAddr;
          additionChainEnv.CHAIN_BOOTSTRAP_VAT_CONFIG = loadgenBootstrapConfig;
        }

        const chainEnv = Object.assign(Object.create(process.env), {
          ...additionChainEnv,
          CHAIN_PORT: `${CHAIN_PORT}`,
        });

        const launcherCp = printerSpawn(
          'agoric',
          ['start', profileName, '--no-restart'],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: chainEnv,
          },
        );

        const ignoreKill = {
          signal: false,
        };

        const launcherDone = childProcessDone(launcherCp, {
          ignoreKill,
          killedExitCode: 98,
        });

        launcherDone.then(
          () => console.log('Chain setup exited successfully'),
          (error) => console.error('Chain setup exited with error', error),
        );

        const launcherCombinedElidedOutput = combineAndPipe(
          launcherCp.stdio,
          stdio,
        );

        const [chainStarted, outputParsed] = whenStreamSteps(
          launcherCombinedElidedOutput,
          [{ matcher: chainStartRE }],
        );

        await chainStarted.then(
          async () => {
            // agoric-cli does not support `--no-restart`, kill the chain
            console.log('Stopping chain setup');
            const launcherInfo = await getProcessInfo(
              /** @type {number} */ (launcherCp.pid),
            );
            const processInfo = await getChildMatchingArgv(
              launcherInfo,
              chainArgvMatcher,
            );
            ignoreKill.signal = true;
            process.kill(processInfo.pid);
          },
          () => {
            // agoric-cli supports `--no-restart`, so output is parsed without outputting step
          },
        );

        await PromiseAllOrErrors([outputParsed, launcherDone]);
      }
    }

    console.log('Done');

    return harden(storageLocations);
  };

  /** @param {import("./types.js").TaskSwingSetOptions} options */
  const runChain = async ({ stdout, stderr, timeout = 180, trace }) => {
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

    const {
      env: traceEnv,
      args: traceArgs,
      cmd: traceCmd,
    } = getExtraEnvArgs({ trace });

    const chainEnv = Object.assign(Object.create(process.env), {
      ...additionChainEnv,
      ...traceEnv,
      SLOGFILE: slogFifo.path,
      DEBUG: VerboseDebugEnv,
    });

    const cmd = traceCmd
      ? /** @type {string} */ (traceCmd.shift())
      : sdkBinaries.cosmosChain;
    const args = [
      ...(traceCmd ? [...traceCmd, sdkBinaries.cosmosChain] : []),
      'start',
      `--home=${chainStateDir}`,
      ...traceArgs,
    ];

    const chainCp = printerSpawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: chainEnv,
      detached: true,
    });

    let stopped = false;
    /** @type {{signal: undefined | true}} */
    const ignoreKill = {
      signal: undefined,
    };

    const chainDone = childProcessDone(chainCp, {
      ignoreKill,
      killedExitCode: 98,
    });

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
        await swingSetLaunched;

        console.log('Chain running');

        const baseProcessInfoP = getProcessInfo(
          /** @type {number} */ (chainCp.pid),
        );

        const processInfo = await (!traceCmd
          ? baseProcessInfoP
          : baseProcessInfoP.then((launcherInfo) =>
              getChildMatchingArgv(
                launcherInfo,
                wrapArgvMatcherIgnoreDashDash(chainArgvMatcher),
              ),
            ));

        const stop = () => {
          if (!stopped) {
            stopped = true;
            ignoreKill.signal = true;
            process.kill(processInfo.pid);
          }
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
        chainCp.kill();
        slogFifo.close();
        await Promise.allSettled([done, ready]);
      },
    );
  };

  /** @param {import("./types.js").TaskSwingSetOptions} options */
  const runClient = async ({ stdout, stderr, timeout = 180, trace }) => {
    const { console, stdio } = getConsoleAndStdio('client', stdout, stderr);
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    console.log('Starting client');

    const gciFile = `${chainStateDir}/config/genesis.json.sha256`;

    if (!(await fsExists(gciFile))) {
      throw new Error('Chain not running');
    }

    const rpcAddr = `localhost:${CHAIN_PORT}`;

    const soloAddr = (
      await fs.readFile(`${clientStateDir}/ag-cosmos-helper-address`, 'utf-8')
    ).trimEnd();

    const keysSharedArgs = [
      `--home=${keysDir}`,
      `--chain-id=${CHAIN_ID}`,
      `--node=tcp://${rpcAddr}`,
    ];

    const outputArgs = ['--output=json'];

    // Provision the ag-solo, if necessary.
    const checkAddrStatus = await childProcessDone(
      printerSpawn(
        sdkBinaries.cosmosHelper,
        [...keysSharedArgs, 'query', 'swingset', 'egress', soloAddr],
        { stdio: 'ignore' },
      ),
      { ignoreExitCode: true },
    );
    if (checkAddrStatus !== 0) {
      const provCmds = [
        // We need to provision our address.
        [
          'tx',
          'swingset',
          'provision-one',
          ...keysSharedArgs,
          '--keyring-backend=test',
          '--from=provision',
          '--gas=auto',
          `--gas-adjustment=${GAS_ADJUSTMENT}`,
          '--broadcast-mode=block',
          '--yes',
          `local-solo-${CLIENT_PORT}`,
          soloAddr,
        ],
        // Then send it some coins.
        [
          'tx',
          'bank',
          'send',
          ...keysSharedArgs,
          '--keyring-backend=test',
          '--gas=auto',
          `--gas-adjustment=${GAS_ADJUSTMENT}`,
          '--broadcast-mode=block',
          '--yes',
          'provision',
          soloAddr,
          SOLO_COINS,
        ],
      ];
      for (let i = 0; i < provCmds.length; i += 1) {
        const cmd = provCmds[i];
        const cmdCp = printerSpawn(
          sdkBinaries.cosmosHelper,
          [...outputArgs, ...cmd],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        // eslint-disable-next-line no-await-in-loop
        const [out, err, cmdStatus] = await PromiseAllOrErrors([
          asBuffer(cmdCp.stdout),
          asBuffer(cmdCp.stderr),
          childProcessDone(cmdCp, {
            ignoreExitCode: true,
          }),
        ]);

        if (cmdStatus !== 0) {
          if (/unknown flag: --output/g.test(err.toString('utf-8'))) {
            outputArgs.pop();
            i -= 1; // Redo
            continue; // eslint-disable-line no-continue
          }
          stdio[2].write(err);
          throw new Error(
            `Client provisioning command failed with status ${cmdStatus}`,
          );
        }

        const json = out.toString('utf-8').replace(/^gas estimate: \d+$/m, '');
        const res = JSON.parse(json);
        console.log(...cmd.slice(0, 3), 'result', res);
        if (res.code !== 0) {
          throw new Error('Client provisioning command failed');
        }
      }
    }

    // Connect to the chain.
    const gci = (await fs.readFile(gciFile, 'utf-8')).trimEnd();
    await childProcessDone(
      printerSpawn(
        sdkBinaries.agSolo,
        ['set-gci-ingress', `--chainID=${CHAIN_ID}`, gci, rpcAddr],
        { stdio, cwd: clientStateDir },
      ),
    );

    const slogFifo = await makeFIFO('client.slog');
    const slogReady = fsStreamReady(slogFifo);
    const slogLines = new BufferLineTransform();
    const slogPipeResult = slogReady.then(() =>
      slogLines.writableEnded ? undefined : pipeline(slogFifo, slogLines),
    );

    const { env: traceEnv } = getExtraEnvArgs({ trace }, 'SOLO_');

    const clientEnv = Object.assign(Object.create(process.env), {
      ...traceEnv,
      SOLO_SLOGFILE: slogFifo.path,
      DEBUG: VerboseDebugEnv,
    });

    const soloCp = printerSpawn(sdkBinaries.agSolo, ['start'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: clientStateDir,
      env: clientEnv,
      detached: true,
    });

    /** @type {{signal: undefined | 'SIGTERM'}} */
    const ignoreKill = {
      signal: undefined,
    };

    const soloCpReady = childProcessReady(soloCp);
    const clientDone = childProcessDone(soloCp, {
      ignoreKill,
      killedExitCode: 98,
    });

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

    const soloCombinedElidedOutput = combineAndPipe(soloCp.stdio, stdio);
    const [clientStarted, walletReady, outputParsed] = whenStreamSteps(
      soloCombinedElidedOutput,
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

    walletReady
      .then(() =>
        Promise.race([
          slogReady,
          Promise.reject(new Error('Slog not supported')),
        ]),
      )
      .catch((err) => console.warn(err.message || err));

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
          ready: walletReady,
          slogLines: cleanAsyncIterable(slogLines),
          storageLocation: clientStateDir,
          processInfo,
        });
      },
      async () => {
        soloCp.kill();
        await Promise.allSettled([done, clientStarted, walletReady]);
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
