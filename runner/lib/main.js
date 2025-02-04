/* global process console:off */

import { resolve as resolvePath, join as joinPath } from 'path';
import { URL } from 'url';
import { performance } from 'perf_hooks';
import zlib from 'zlib';
import { promisify } from 'util';
import {
  pipeline as pipelineCallback,
  finished as finishedCallback,
  Readable,
  PassThrough,
} from 'stream';

import yargsParser from 'yargs-parser';
import chalk from 'chalk';
import { makePromiseKit } from '@endo/promise-kit';
import { resolve as importMetaResolve } from './helpers/module.js';

import {
  sleep,
  aggregateTryFinally,
  sequential,
  tryTimeout,
} from './helpers/async.js';
import { childProcessDone } from './helpers/child-process.js';
import { fsStreamReady, makeFsHelper } from './helpers/fs.js';
import { makeProcfsHelper } from './helpers/procsfs.js';
import { makeOutputter } from './helpers/outputter.js';

import { makeTasks as makeLocalChainTasks } from './tasks/local-chain.js';
import { makeTasks as makeTestnetTasks } from './tasks/testnet.js';

import { makeChainMonitor } from './monitor/chain-monitor.js';
import { monitorSlog } from './monitor/slog-monitor.js';
import { monitorLoadgen } from './monitor/loadgen-monitor.js';
import { makeRunStats } from './stats/run.js';
import { makeTimeSource } from './helpers/time.js';

/** @typedef {import('./helpers/async.js').Task} Task */

const FILE_ENCODING = 'utf-8';

const pipeline = promisify(pipelineCallback);
const finished = promisify(finishedCallback);

const defaultLoadgenConfig = {
  vault: { interval: 12, limit: 10 },
  amm: { wait: 6, interval: 12, limit: 10 },
};
const defaultMonitorIntervalMinutes = 5;
const defaultStageDurationMinutes = 30;
const defaultNumberStages = 4 + 2;

const defaultBootstrapConfigs = {
  loadgen: 'decentral-loadgen-config.json',
  demo: 'decentral-demo-config.json',
  base: 'decentral-config.json',
  custom: undefined,
};

/**
 * @template {Record<string, unknown> | undefined} T
 * @param {unknown} maybeObj
 * @param {T} defaultValue
 */
const coerceRecordOption = (maybeObj, defaultValue) => {
  if (maybeObj == null) {
    return /** @type {T extends undefined ? undefined : Record<string, unknown>} */ (
      defaultValue
    );
  }

  if (typeof maybeObj !== 'object') {
    throw new Error('Unexpected object option value');
  }

  return /** @type {Record<string, unknown>} */ (maybeObj);
};

/**
 * @template {boolean | undefined} T
 * @param {unknown} maybeBoolValue
 * @param {T} defaultValue
 * @param {boolean} [assertBool]
 */
const coerceBooleanOption = (
  maybeBoolValue,
  defaultValue,
  assertBool = true,
) => {
  const value =
    assertBool && Array.isArray(maybeBoolValue)
      ? maybeBoolValue.slice(-1)[0]
      : maybeBoolValue;

  switch (value) {
    case 1:
    case true:
    case 'true':
      return true;
    case 0:
    case false:
    case 'false':
      return false;
    case null:
    case undefined:
      return defaultValue;
    default:
      if (assertBool) {
        throw new Error(`Unexpected boolean option value ${maybeBoolValue}`);
      }
      return defaultValue;
  }
};

/**
 * @param {object} param0
 * @param {Console} param0.console
 */
const makeInterrupterKit = ({ console }) => {
  const signal = makePromiseKit();
  /** @type {NodeJS.ErrnoException | null} */
  let rejection = null;
  const onInterrupt = () => {
    if (rejection) {
      console.warn('Interruption already in progress');
    } else {
      rejection = new Error('Interrupted');
      rejection.code = 'ERR_SCRIPT_EXECUTION_INTERRUPTED';
      signal.reject(rejection);
    }
  };
  const onExit = () => {
    throw new Error('Interrupt was not cleaned up');
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);
  process.on('exit', onExit);

  let orInterruptCalled = false;

  const orInterrupt = async (job = new Promise(() => {})) => {
    orInterruptCalled = true;
    return Promise.race([signal.promise, job]);
  };

  const releaseInterrupt = async () => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onInterrupt);
    process.off('exit', onExit);
    if (!orInterruptCalled && rejection) {
      throw rejection;
    }
  };

  // Prevent unhandled rejection when orInterrupt is called after interruption
  signal.promise.catch(() => {});

  return { orInterrupt, releaseInterrupt };
};

/**
 * @returns {Promise<import('./tasks/types.js').SDKBinaries>}
 */
const getSDKBinaries = async () => {
  const srcHelpers = 'agoric/src/helpers.js';
  const libHelpers = 'agoric/lib/helpers.js';
  try {
    const cliHelpers = await import(srcHelpers).catch(() => import(libHelpers));
    return cliHelpers.getSDKBinaries();
  } catch (err) {
    // Older SDKs were only at lib
    const cliHelpersUrl = await importMetaResolve(libHelpers, import.meta.url);
    // Prefer CJS as some versions have both and must use .cjs for RESM
    let agSolo = new URL('../../solo/src/entrypoint.cjs', cliHelpersUrl)
      .pathname;
    if (
      !(await importMetaResolve(agSolo, import.meta.url).then(
        () => true,
        () => false,
      ))
    ) {
      agSolo = agSolo.replace(/\.cjs$/, '.js');
    }
    return {
      agSolo,
      cosmosChain: new URL(
        '../../cosmic-swingset/bin/ag-chain-cosmos',
        cliHelpersUrl,
      ).pathname,
      cosmosHelper: new URL(
        // The older SDKs without getSDKBinaries hadn't renamed to agd yet
        '../../../golang/cosmos/build/ag-cosmos-helper',
        cliHelpersUrl,
      ).pathname,
    };
  }
};

/**
 *
 * @param {string} progName
 * @param {string[]} rawArgs
 * @param {object} powers
 * @param {import("stream").Writable} powers.stdout
 * @param {import("stream").Writable} powers.stderr
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {import("./helpers/fs.js").fsStream} powers.fsStream Node.js fs stream operations
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {string} powers.tmpDir Directory location to place temporary files in
 */
const main = async (progName, rawArgs, powers) => {
  const { stdout, stderr, fs, fsStream, spawn, tmpDir } = powers;

  // TODO: switch to full yargs for documenting output
  const argv = yargsParser(rawArgs, {
    array: ['trace'],
    configuration: {
      'duplicate-arguments-array': false,
      'flatten-duplicate-arrays': false,
      'greedy-arrays': true,
      'strip-dashed': true,
    },
  });
  const messageFilePath = process.env.MESSAGE_FILE_PATH;

  const { getProcessInfo, getCPUTimeOffset } = makeProcfsHelper({ fs, spawn });
  const { dirDiskUsage, makeFIFO } = makeFsHelper({
    fs,
    fsStream,
    spawn,
    tmpDir,
  });

  /**
   * @param {string} [prefix]
   * @param {import("stream").Writable} [out]
   * @param {import("stream").Writable} [err]
   */
  const makeConsole = (prefix, out = stdout, err = stderr) =>
    makeOutputter({
      out,
      err,
      outPrefix: prefix && `${chalk.green(prefix)}: `,
      errPrefix: prefix && `${chalk.bold.red(prefix)}: `,
    });

  /**
   * @param {string} source
   * @param {string} tmpSuffix
   * @param {string} destination
   */
  const backgroundCompressFolder = async (source, tmpSuffix, destination) => {
    const tmp = `${source}${tmpSuffix}`;
    const cleanup = async () => {
      await childProcessDone(spawn('rm', ['-rf', tmp]));
    };

    try {
      await childProcessDone(
        spawn('cp', ['-a', '--reflink=auto', source, tmp]),
      );
    } catch (err) {
      await aggregateTryFinally(cleanup, () => Promise.reject(err));
    }

    return {
      done: aggregateTryFinally(async () => {
        await childProcessDone(spawn('tar', ['-cSJf', destination, tmp]));
      }, cleanup),
    };
  };

  /**
   * @param {ReturnType<typeof makeConsole>['console']} console
   * @param {string} message
   */
  const writeMessageToMessageFile = (console, message) => {
    if (!messageFilePath) throw Error('MESSAGE_FILE_PATH not present in env');

    console.log(`Writing message "${message}" to file "${messageFilePath}"`);
    return fs.writeFile(messageFilePath, message, {
      encoding: FILE_ENCODING,
    });
  };

  const { console: topConsole } = makeConsole();

  const outputDir = resolvePath(argv.outputDir || `results/run-${Date.now()}`);
  topConsole.log(`Outputting to ${outputDir}`);
  await fs.mkdir(outputDir, { recursive: true });

  /** @type {typeof makeLocalChainTasks | typeof makeTestnetTasks} */
  let makeTasks;
  /** @type {string} */
  let testnetOrigin;

  /** @type {boolean | undefined} */
  let useStateSync;

  const profile = argv.profile == null ? 'local' : argv.profile;

  switch (profile) {
    case 'local':
      makeTasks = makeLocalChainTasks;
      testnetOrigin = '';
      break;
    case 'devnet':
    case 'testnet':
    case 'stage':
      makeTasks = makeTestnetTasks;
      testnetOrigin = argv.testnetOrigin || `https://${profile}.agoric.net`;
      useStateSync = argv.useStateSync;
      break;
    default:
      throw new Error(`Unexpected profile option: ${profile}`);
  }

  const monitorInterval =
    Number(argv.monitorInterval || defaultMonitorIntervalMinutes) * 60 * 1000;

  let currentStage = -1;
  /** @type {Promise<void>[]} */
  const pendingBackups = [];
  const timeSource = makeTimeSource({ performance });
  const cpuTimeOffset = await getCPUTimeOffset().catch(() => 0);
  const cpuTimeSource = timeSource.shift(0 - cpuTimeOffset);
  let currentStageTimeSource = timeSource;

  const hasCustomBootstrapConfig = typeof argv.customBootstrap === 'string';
  const withBootstrap = coerceBooleanOption(
    argv.customBootstrap,
    hasCustomBootstrapConfig || makeTasks === makeLocalChainTasks,
    false,
  );
  const bootstrapConfigs = {
    ...defaultBootstrapConfigs,
    ...(hasCustomBootstrapConfig
      ? {
          custom: argv.customBootstrap,
        }
      : {}),
  };

  const [sdkBinaries, loadgenBootstrapConfig] = await Promise.all([
    getSDKBinaries(),
    !withBootstrap
      ? undefined
      : Promise.all(
          Object.entries(bootstrapConfigs).map(async ([name, identifier]) => [
            name,
            identifier &&
              (await importMetaResolve(
                `@agoric/vm-config/${identifier}`,
                import.meta.url,
              )
                .catch(() =>
                  importMetaResolve(
                    `@agoric/vats/${identifier}`,
                    import.meta.url,
                  ),
                )
                .catch(() => importMetaResolve(identifier, import.meta.url))
                .catch(() => {})),
          ]),
        ).then((entries) => {
          /** @type {Record<keyof typeof defaultBootstrapConfigs, string | undefined>} */
          const { custom, loadgen, demo, base } = Object.fromEntries(entries);

          if (custom) {
            return custom;
          } else if (hasCustomBootstrapConfig) {
            throw new Error('Custom bootstrap config missing.');
          }

          if (loadgen) {
            return loadgen;
          } else if (demo && !base) {
            // Demo config is partially usable when the default config became the core one
            // In https://github.com/Agoric/agoric-sdk/pull/4541
            topConsole.warn('Loadgen bootstrap config missing, using demo.');
            return demo;
          } else {
            topConsole.warn('Loadgen bootstrap config missing, using default.');
            return undefined;
          }
        }),
  ]);

  const { getEnvInfo, setupTasks, runChain, runClient, runLoadgen } = makeTasks(
    {
      spawn,
      fs,
      makeFIFO,
      getProcessInfo,
      sdkBinaries,
      loadgenBootstrapConfig,
    },
  );

  const outputStream = fsStream.createWriteStream(
    joinPath(outputDir, 'perf.jsonl'),
    { flags: 'wx' },
  );
  await fsStreamReady(outputStream);

  const envInfo = await getEnvInfo({ stdout, stderr });
  topConsole.log(envInfo);

  const runStats = makeRunStats({
    metadata: {
      profile,
      testnetOrigin,
      useStateSync,
      ...envInfo,
      testData: argv.testData,
    },
  });

  /** @type {import('./stats/types.js').LogPerfEvent} */
  const logPerfEvent = (eventType, data = {}) => {
    outputStream.write(
      JSON.stringify(
        {
          timestamp: timeSource.now(),
          stage: currentStage,
          elapsed: currentStageTimeSource.now(),
          time: undefined, // Placeholder to put data.time before type if it exists
          type: `perf-${eventType}`,
          ...data,
        },
        (_, arg) => (typeof arg === 'bigint' ? Number(arg) : arg),
      ),
    );
    outputStream.write('\n');
  };

  /** @type {import('./tasks/types.js').CosmicSwingSetTracingKeys[]} */
  const allowedTracingOptions = ['xsnap', 'kvstore', 'swingstore'];
  /** @type {import('./tasks/types.js').CosmicSwingSetTracingKeys[]} */
  const tracing = [];

  if (argv.trace) {
    // If `--trace` is specified without values, enable all
    if (!argv.trace.length) {
      argv.trace = allowedTracingOptions;
    }

    // `--no-trace` results in `[ false ]`
    if (argv.trace.length === 0 && argv.trace[0] === false) {
      argv.trace = [];
    }

    if (!Array.isArray(argv.trace)) {
      throw new Error(`Invalid 'trace' option: ${argv.trace}`);
    }

    for (const val of argv.trace) {
      if (!allowedTracingOptions.includes(val)) {
        topConsole.log(`Ignoring 'trace' option value "${val}"`);
      } else {
        tracing.push(val);
      }
    }
  }

  /**
   * @param {'client' | 'chain'} role
   * @returns {import('./tasks/types.js').TaskSwingSetOptions['trace']}
   */
  const makeTraceOption = (role) => {
    return Object.fromEntries(
      tracing
        .filter((val) => role === 'chain' || val !== 'kvstore')
        .map((val) => [
          val,
          `${outputDir}/${role}-stage-${currentStage}-${val}-trace`,
        ]),
    );
  };

  /**
   * @param {object} config
   * @param {boolean} config.chainOnly
   * @param {number} config.durationConfig
   * @param {number} config.cycleCount
   * @param {unknown} config.loadgenConfig
   * @param {boolean | undefined} [config.loadgenWindDown]
   * @param {boolean} config.withMonitor
   * @param {string | void} config.chainStorageLocation
   * @param {boolean} config.integrateAcceptance
   */
  const runStage = async (config) => {
    const {
      chainOnly,
      durationConfig,
      cycleCount,
      loadgenConfig,
      loadgenWindDown,
      withMonitor,
      chainStorageLocation,
      integrateAcceptance,
    } = config;
    currentStageTimeSource = timeSource.shift();

    const { out, err } = makeConsole(`stage-${currentStage}`);
    const { console: stageConsole } = makeConsole('runner', out, err);

    const { orInterrupt, releaseInterrupt } = makeInterrupterKit({
      console: stageConsole,
    });

    logPerfEvent('stage-start');
    stageConsole.log('Starting stage', config);
    const stageStart = timeSource.shift();

    const stats = runStats.newStage({
      stageIndex: currentStage,
      stageConfig: config,
    });

    /**
     * @type {Task}
     *
     * This task will always run in three stages
     *
     * The first stage will signal to the tests runner that the
     * follower has caught up to the chain (this catching up will
     * be covered by the `spawnChain` task) and exit
     *
     * The second stage will keep running the follower and wait
     * for a stop signal from the test runner at which point it
     * will stop the chain process and exit
     */
    const spwanAcceptance = async (nextStep) => {
      /**
       * @param {RegExp} [regex]
       */
      const waitForMessageFromMessageFile = async (regex) => {
        if (!messageFilePath)
          throw Error('MESSAGE_FILE_PATH not present in env');

        stageConsole.log(
          `Starting to wait for message of format "${regex}" from file "${messageFilePath}"`,
        );

        for await (const { eventType } of fs.watch(messageFilePath))
          if (eventType === 'change') {
            const fileContent = (
              await fs.readFile(messageFilePath, FILE_ENCODING)
            ).trim();
            if (regex && !regex.test(fileContent))
              stageConsole.warn(
                'Ignoring unsupported file content: ',
                fileContent,
              );
            else return fileContent;
          }

        return undefined;
      };

      if (currentStage === 1)
        await writeMessageToMessageFile(stageConsole, 'ready');
      else if (currentStage === 2) await waitForMessageFromMessageFile(/stop/);

      await nextStep(Promise.resolve());
    };

    /** @type {Task} */
    const spawnChain = async (nextStep) => {
      stageConsole.log('Running chain');
      logPerfEvent('run-chain-start');
      const runChainResult = await runChain({
        stdout: out,
        stderr: err,
        trace: makeTraceOption('chain'),
      });
      logPerfEvent('run-chain-finish');
      stats.recordChainStart(timeSource.getTime());

      let chainExited = false;
      const done = runChainResult.done.finally(() => {
        chainExited = true;
        logPerfEvent('chain-stopped');
      });

      if (runChainResult.processInfo) {
        currentStageTimeSource = cpuTimeSource.shift(
          runChainResult.processInfo.startTimestamp,
        );
      }

      const slogLinesStream = Readable.from(runChainResult.slogLines);
      const slogLines = new PassThrough({ objectMode: true });

      const slogOutput = zlib.createGzip({
        level: zlib.constants.Z_BEST_COMPRESSION,
      });
      const slogOutputWriteStream = fsStream.createWriteStream(
        joinPath(outputDir, `chain-stage-${currentStage}.slog.gz`),
      );
      await fsStreamReady(slogOutputWriteStream);
      // const slogOutput = slogOutputWriteStream;
      // const slogOutputPipeResult = finished(slogOutput);
      slogLinesStream.pipe(slogLines);
      const slogOutputPipeResult = pipeline(
        slogLinesStream,
        slogOutput,
        slogOutputWriteStream,
      );

      /** @type {import("@endo/promise-kit").PromiseRecord<void>} */
      const firstBlockDoneKit = makePromiseKit();
      /** @type {(() => void) | null} */
      let resolveFirstBlockDone = firstBlockDoneKit.resolve;

      /** @type {(() => void) | null} */
      let resolveFirstEmptyBlock = null;
      let emptyBlockRetries = 10;

      const notifier = {
        /** @param {import('./stats/types.js').BlockStats} block */
        blockDone(block) {
          if (resolveFirstBlockDone) {
            resolveFirstBlockDone();
            resolveFirstBlockDone = null;
          }

          if (resolveFirstEmptyBlock) {
            if (
              block.slogLines === 0 ||
              block.computrons === 0 ||
              emptyBlockRetries === 0
            ) {
              if (block.slogLines === 0 || block.computrons === 0) {
                logPerfEvent('stage-first-empty-block', {
                  block: block.blockHeight,
                });
              }
              resolveFirstEmptyBlock();
              resolveFirstEmptyBlock = null;
            } else {
              emptyBlockRetries -= 1;
            }
          }
        },
      };

      const chainMonitor =
        /** @type {undefined | true} */ (undefined) &&
        runChainResult.processInfo &&
        makeChainMonitor(
          {
            processInfo: runChainResult.processInfo,
            storageLocation: chainStorageLocation,
          },
          {
            ...makeConsole('monitor-chain', out, err),
            logPerfEvent,
            cpuTimeSource,
            dirDiskUsage,
          },
        );
      chainMonitor?.start(monitorInterval);

      const slogMonitorDone = monitorSlog(
        { slogLines },
        {
          ...makeConsole('monitor-slog', out, err),
          stats,
          notifier,
          chainMonitor,
          localTimeSource: timeSource,
          logPerfEvent,
        },
      );

      await aggregateTryFinally(
        async () => {
          await orInterrupt(runChainResult.ready);
          stats.recordChainReady(timeSource.getTime());
          logPerfEvent('chain-ready');
          stageConsole.log('Chain ready');

          /** @type {import("@endo/promise-kit").PromiseRecord<void>} */
          const firstEmptyBlockKit = makePromiseKit();
          resolveFirstEmptyBlock = firstEmptyBlockKit.resolve;

          await tryTimeout(5 * 60 * 1000, async () => {
            await Promise.race([
              done,
              slogMonitorDone,
              orInterrupt(firstBlockDoneKit.promise),
            ]);
            await Promise.race([
              done,
              slogMonitorDone,
              orInterrupt(firstEmptyBlockKit.promise),
            ]);
          });

          await nextStep(done);
        },
        async () =>
          aggregateTryFinally(
            async () => {
              chainMonitor?.stop();

              if (!chainExited) {
                stageConsole.log('Stopping chain');

                runChainResult.stop();
                await done;
              }

              await slogMonitorDone;
            },
            async () => {
              slogOutput.end();
              await slogOutputPipeResult;
            },
          ),
      );
    };

    /** @type {Task} */
    const spawnClient = async (nextStep) => {
      stageConsole.log('Running client');
      logPerfEvent('run-client-start');
      const runClientResult = await runClient({
        stdout: out,
        stderr: err,
        trace: makeTraceOption('client'),
      });
      logPerfEvent('run-client-finish');
      stats.recordClientStart(timeSource.getTime());

      let clientExited = false;
      const done = runClientResult.done.finally(() => {
        clientExited = true;
        logPerfEvent('client-stopped');
      });

      const slogOutput = zlib.createGzip({
        level: zlib.constants.Z_BEST_COMPRESSION,
      });
      const slogOutputWriteStream = fsStream.createWriteStream(
        joinPath(outputDir, `client-stage-${currentStage}.slog.gz`),
      );
      await fsStreamReady(slogOutputWriteStream);
      const slogOutputPipeResult = pipeline(
        runClientResult.slogLines,
        slogOutput,
        slogOutputWriteStream,
      );

      await aggregateTryFinally(
        async () => {
          await tryTimeout(10 * 60 * 1000, () =>
            orInterrupt(runClientResult.ready),
          );
          stats.recordClientReady(timeSource.getTime());
          logPerfEvent('client-ready', {
            duration: stats.clientInitDuration,
          });
          if (!runStats.walletDeployEndedAt) {
            runStats.recordWalletDeployStart(
              /** @type {number} */ (stats.clientStartedAt),
            );
            runStats.recordWalletDeployEnd(
              /** @type {number} */ (stats.clientReadyAt),
            );
          }

          await nextStep(done);
        },
        async () =>
          aggregateTryFinally(
            async () => {
              if (!clientExited) {
                stageConsole.log('Stopping client');

                runClientResult.stop();
                await done;
              }
            },
            async () => {
              await slogOutputPipeResult;
            },
          ),
      );
    };

    /** @type {Task} */
    const spawnLoadgen = async (nextStep) => {
      stageConsole.log('Running load gen');
      logPerfEvent('run-loadgen-start');
      const runLoadgenResult = await runLoadgen({
        stdout: out,
        stderr: err,
      });
      stats.recordLoadgenStart(timeSource.getTime());
      logPerfEvent('run-loadgen-finish');

      let loadgenExited = false;
      const done = runLoadgenResult.done.finally(() => {
        loadgenExited = true;
        logPerfEvent('loadgen-stopped');
      });

      /** @type {Error | null} */
      let loadgenTaskFailed = null;
      /** @type {import('@endo/promise-kit').PromiseRecord<void>} */
      const stopLoadgenKit = makePromiseKit();

      const notifier = {
        currentCount: 0,
        totalCycles: 0,
        /**
         * @param {string} _task
         * @param {number} _seq
         */
        start(_task, _seq) {
          notifier.currentCount += 1;
          notifier.totalCycles += 1;
          if (notifier.totalCycles >= cycleCount) {
            stopLoadgenKit.resolve();
          }
        },
        /**
         * @param {string} task
         * @param {number} seq
         * @param {boolean} success
         */
        finish(task, seq, success) {
          const newCount = notifier.currentCount - 1;
          notifier.currentCount = newCount;
          if (success) {
            if (newCount === 0 && notifier.idleCallback) {
              notifier.idleCallback();
            }
          } else {
            loadgenTaskFailed = new Error(`Loadgen ${task} task ${seq} failed`);
            if (notifier.idleCallback) {
              notifier.idleCallback();
            } else {
              stopLoadgenKit.resolve();
            }
          }
        },
        /** @type {null | (() => void)} */
        idleCallback: null,
      };

      const monitorLoadgenDone = monitorLoadgen(runLoadgenResult, {
        ...makeConsole('monitor-loadgen', out, err),
        stats,
        notifier,
      });

      await aggregateTryFinally(
        async () => {
          await tryTimeout(10 * 60 * 1000, () =>
            orInterrupt(runLoadgenResult.ready),
          );
          stats.recordLoadgenReady(timeSource.getTime());
          logPerfEvent('loadgen-ready');
          if (!runStats.loadgenDeployEndedAt) {
            runStats.recordLoadgenDeployStart(
              /** @type {number} */ (stats.loadgenStartedAt),
            );
            runStats.recordLoadgenDeployEnd(
              /** @type {number} */ (stats.loadgenReadyAt),
            );
          }

          if (loadgenConfig != null) {
            await runLoadgenResult.updateConfig(loadgenConfig);
          }

          await nextStep(Promise.race([done, stopLoadgenKit.promise]));

          if (loadgenWindDown && notifier.currentCount && !loadgenTaskFailed) {
            /** @type {Promise<void>} */
            const idle = new Promise((resolve) => {
              notifier.idleCallback = resolve;
            });

            await runLoadgenResult.updateConfig(null);
            const maxCycleDuration =
              Object.values(stats.cycles).reduce(
                (max, cycleStats) =>
                  cycleStats &&
                  cycleStats.duration != null &&
                  !Number.isNaN(cycleStats.duration)
                    ? Math.max(max, cycleStats.duration)
                    : max,
                0,
              ) || 2 * 60;
            const sleepTime = Math.max(
              (maxCycleDuration + 2 * 6) * 1.2,
              durationConfig - stageStart.now(),
            );
            stageConsole.log(
              `Waiting for loadgen tasks to end (Max ${sleepTime}s)`,
            );
            await orInterrupt(Promise.race([idle, sleep(sleepTime * 1000)]));
          }
        },
        async () => {
          if (!loadgenExited) {
            stageConsole.log('Stopping loadgen');

            runLoadgenResult.stop();
            await done;
          }

          await monitorLoadgenDone;

          if (loadgenTaskFailed) {
            throw loadgenTaskFailed;
          }

          if (
            loadgenWindDown &&
            Number.isFinite(cycleCount) &&
            notifier.totalCycles - notifier.currentCount < cycleCount
          ) {
            throw new Error('Not all requested cycles completed');
          }
        },
      );
    };

    /** @type {Task} */
    const stageReady = async (nextStep) => {
      /** @type {Promise<void>} */
      let sleeping;
      /** @type {import("@endo/promise-kit").PromiseRecord<void>} */
      const sleepCancel = makePromiseKit();
      if (durationConfig < 0) {
        // sleeping forever
        sleeping = new Promise(() => {});
        stageConsole.log('Stage ready, waiting for end of chain');
      } else {
        const sleepTime = Math.max(0, durationConfig - stageStart.now());
        if (sleepTime) {
          sleeping = sleep(sleepTime * 1000, sleepCancel.promise);
          stageConsole.log(
            'Stage ready, going to sleep for',
            Math.round(sleepTime / 60),
            'minutes',
          );
        } else {
          sleeping = Promise.resolve();
          stageConsole.log('Stage ready, no time to sleep, moving on');
        }
      }
      stats.recordReady(timeSource.getTime());
      logPerfEvent('stage-ready');
      await nextStep(sleeping).finally(sleepCancel.resolve);
      stats.recordShutdown(timeSource.getTime());
      logPerfEvent('stage-shutdown');
    };

    await aggregateTryFinally(
      async () => {
        /** @type {Task} */
        const rootTask = async (nextStep) => {
          const done = orInterrupt();
          done.catch(() => {});
          await nextStep(done);
        };

        /** @type {Task[]} */
        const tasks = [rootTask];

        if (withMonitor) {
          tasks.push(spawnChain);
        }

        if (!chainOnly) tasks.push(spawnClient, spawnLoadgen);
        else if (integrateAcceptance) tasks.push(spwanAcceptance);

        if (tasks.length === 1) {
          throw new Error('Nothing to do');
        } else {
          tasks.push(stageReady);
        }
        stats.recordStart(timeSource.getTime());
        await sequential(...tasks)((stop) => stop).finally(() =>
          stats.recordEnd(timeSource.getTime()),
        );
      },
      async () => {
        releaseInterrupt();

        logPerfEvent('stage-finish');
        stageConsole.log('Live blocks stats:', {
          ...((stats.blocksSummaries && stats.blocksSummaries.onlyLive) || {
            blockCount: 0,
          }),
        });
        stageConsole.log('Cycles stats:', {
          ...((stats.cyclesSummaries && stats.cyclesSummaries.all) || {
            cycleCount: 0,
          }),
        });
        currentStageTimeSource = timeSource;
      },
    );
  };
  const integrateAcceptance = coerceBooleanOption(
    argv.integrateAcceptance,
    false,
    true,
  );

  // Main

  await aggregateTryFinally(
    async () => {
      const { console: initConsole, out, err } = makeConsole('init');
      runStats.recordStart(timeSource.getTime());
      logPerfEvent('start', {
        cpuTimeOffset,
        timeOrigin: timeSource.timeOrigin,
        // TODO: add other interesting info here
      });

      const withMonitor = coerceBooleanOption(argv.monitor, true);
      const globalChainOnly = coerceBooleanOption(argv.chainOnly, undefined);
      /** @type {string | void} */
      let chainStorageLocation;
      /** @type {string | void} */
      let clientStorageLocation;
      {
        const { orInterrupt, releaseInterrupt } = makeInterrupterKit({
          console: initConsole,
        });

        const reset = coerceBooleanOption(argv.reset, true);
        const setupConfig = {
          reset,
          chainOnly: globalChainOnly,
          withMonitor,
          testnetOrigin,
          useStateSync,
        };
        logPerfEvent('setup-tasks-start', setupConfig);
        ({ chainStorageLocation, clientStorageLocation } =
          await aggregateTryFinally(
            // Do not short-circuit on interrupt, let the spawned setup process terminate
            async () =>
              setupTasks({
                stdout: out,
                stderr: err,
                orInterrupt,
                config: setupConfig,
              }),

            // This will throw if there was any interrupt, and prevent further execution
            async () => releaseInterrupt(),
          ));
        logPerfEvent('setup-tasks-finish');
      }

      const stages =
        argv.stages != null
          ? parseInt(String(argv.stages), 10)
          : defaultNumberStages;

      const stageConfigs = coerceRecordOption(argv.stage, {});

      const sharedLoadgenConfig = coerceRecordOption(
        stageConfigs.loadgen,
        defaultLoadgenConfig,
      );

      const sharedLoadgenWindDown = coerceBooleanOption(
        stageConfigs.loadgenWindDown,
        true,
      );

      const sharedSavedStorage = coerceBooleanOption(
        stageConfigs.saveStorage,
        undefined,
      );

      // Shared stage duration can only be positive
      const sharedStageDurationMinutesRaw =
        stageConfigs.duration != null
          ? Number(stageConfigs.duration)
          : undefined;
      const sharedStageDurationMinutes =
        sharedStageDurationMinutesRaw && sharedStageDurationMinutesRaw > 0
          ? sharedStageDurationMinutesRaw
          : defaultStageDurationMinutes;

      while (currentStage < stages - 1) {
        currentStage += 1;

        const stageConfig = coerceRecordOption(stageConfigs[currentStage], {});

        let stageWithLoadgen = coerceBooleanOption(
          stageConfig.loadgen,
          undefined,
          false,
        );

        const stageLoadgenConfig =
          stageWithLoadgen == null
            ? coerceRecordOption(stageConfig.loadgen, undefined)
            : undefined;
        if (stageLoadgenConfig) {
          stageWithLoadgen = true;
        }

        let stageDurationMinutes =
          stageConfig.duration != null
            ? Number(stageConfig.duration)
            : undefined;

        const loadgenWindDown = coerceBooleanOption(
          stageConfig.loadgenWindDown,
          sharedLoadgenWindDown,
        );

        const stageChainOnly = coerceBooleanOption(
          stageConfig.chainOnly,
          undefined,
        );

        // By default the last stage will only capture the chain restart time
        // unless loadgen was explicitly requested on this stage
        const defaultChainOnly =
          withMonitor && // If monitor is disabled, chainOnly has no meaning
          stageChainOnly !== false &&
          (stageWithLoadgen === false ||
            (stageWithLoadgen == null &&
              stages > 2 &&
              currentStage === stages - 1));
        // global chainOnly=true takes precedence
        const chainOnly = globalChainOnly || stageChainOnly || defaultChainOnly;

        if (chainOnly) {
          if (!withMonitor) {
            initConsole.error(`Stage ${currentStage} has conflicting config`, {
              chainOnly,
              withMonitor,
            });
            throw new Error('Invalid config');
          }
          if (stageWithLoadgen) {
            initConsole.warn(
              `Stage ${currentStage} has conflicting config, ignoring loadgen`,
              {
                chainOnly,
                withLoadgen: stageWithLoadgen,
              },
            );
            stageWithLoadgen = !chainOnly;
          }
        }

        if (
          chainOnly &&
          makeTasks === makeLocalChainTasks &&
          stageDurationMinutes
        ) {
          initConsole.warn(
            `Stage ${currentStage} has conflicting config, ignoring duration`,
            {
              profile,
              chainOnly,
              duration: stageDurationMinutes,
            },
          );
          stageDurationMinutes = undefined;
        }

        const saveStorage = coerceBooleanOption(
          stageConfig.saveStorage,
          sharedSavedStorage !== undefined
            ? sharedSavedStorage
            : !defaultChainOnly,
        );

        const { cycles: stageCyclesConfig, ...stageLoadgenConfigRaw } =
          stageLoadgenConfig || sharedLoadgenConfig;

        const stageCycleCountRaw =
          stageCyclesConfig != null ? Number(stageCyclesConfig) : undefined;

        // By default the first stage only initializes but doesn't actually set any load
        // Unless loadgen requested or duration explicitly set
        const activeLoadgen =
          (stageWithLoadgen || (stageWithLoadgen == null && !chainOnly)) &&
          stageDurationMinutes !== 0 &&
          stageCycleCountRaw !== 0 &&
          (stageWithLoadgen ||
            stageDurationMinutes != null ||
            (stageLoadgenConfig && stageLoadgenConfig.cycles) != null ||
            stages === 1 ||
            currentStage > 0);

        const defaultDurationMinutes = activeLoadgen
          ? sharedStageDurationMinutes
          : 0;
        const duration =
          (stageDurationMinutes != null
            ? stageDurationMinutes
            : defaultDurationMinutes) * 60;

        const loadgenConfig = activeLoadgen ? stageLoadgenConfigRaw : null;

        const cycleCountIfActive =
          stageCycleCountRaw && stageCycleCountRaw > 0
            ? stageCycleCountRaw
            : Infinity;
        const cycleCount = activeLoadgen ? cycleCountIfActive : 0;

        // eslint-disable-next-line no-await-in-loop
        await aggregateTryFinally(
          () =>
            runStage({
              chainOnly,
              durationConfig: duration,
              cycleCount,
              loadgenConfig,
              loadgenWindDown,
              withMonitor,
              chainStorageLocation,
              integrateAcceptance,
            }),
          async (...stageError) => {
            const suffix = `-stage-${currentStage}`;
            const hasError =
              stageError.length > 0 &&
              /** @type {NodeJS.ErrnoException} */ (stageError[0]).code !==
                'ERR_SCRIPT_EXECUTION_INTERRUPTED';

            if (!saveStorage && !hasError) {
              return;
            }

            /** @type {Record<string, string | void>} */
            const locations = {};
            if (withMonitor || hasError) {
              locations.chain = chainStorageLocation;
            }
            if (!chainOnly || hasError) {
              locations.client = clientStorageLocation;
            }

            const backupResults = await Promise.all(
              Object.entries(locations).map(([role, location]) => {
                if (location != null) {
                  initConsole.log(`Saving ${role} storage`);
                  return backgroundCompressFolder(
                    location,
                    suffix,
                    joinPath(outputDir, `${role}${suffix}-storage.tar.xz`),
                  );
                }
                return undefined;
              }),
            );

            for (const result of backupResults) {
              if (result) {
                pendingBackups.push(result.done);
              }
            }
          },
        );
      }

      runStats.recordEnd(timeSource.getTime());
    },
    async (error) => {
      logPerfEvent('finish', { stats: runStats });
      if (integrateAcceptance)
        writeMessageToMessageFile(topConsole, `exit code ${Number(!!error)}`);

      outputStream.end();

      const { console } = makeConsole('summary');

      await aggregateTryFinally(
        async () => {
          const backupsDone = Promise.all(pendingBackups).then(() => true);
          if (
            !(await Promise.race([
              backupsDone,
              Promise.resolve().then(() => false),
            ]))
          ) {
            console.log('Waiting for storage backups to finish');
          }
          await backupsDone;
        },
        async () => {
          console.log('Live blocks stats:', {
            ...(runStats.liveBlocksSummary || {
              blockCount: 0,
            }),
          });
          console.log('Cycles stats:', {
            ...(runStats.cyclesSummary || {
              cycleCount: 0,
            }),
          });

          await finished(outputStream);
        },
      );
    },
  );
};

export default main;
