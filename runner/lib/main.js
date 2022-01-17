/* global process console:off */

import { resolve as resolvePath, join as joinPath } from 'path';
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
import { makePromiseKit } from './sdk/promise-kit.js';

import { sleep, aggregateTryFinally, sequential } from './helpers/async.js';
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

const pipeline = promisify(pipelineCallback);
const finished = promisify(finishedCallback);

const defaultLoadgenConfig = {
  vault: { interval: 120 },
  amm: { wait: 60, interval: 120 },
};
const defaultMonitorIntervalMinutes = 5;
const defaultStageDurationMinutes = 6 * 60;
const defaultNumberStages = 4 + 2;

/**
 * @param {unknown} maybeObj
 * @param {Record<string, unknown>} [defaultValue]
 */
const coerceRecordOption = (maybeObj, defaultValue = {}) => {
  if (maybeObj == null) {
    return defaultValue;
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
 * @param {Object} param0
 * @param {Console} param0.console
 */
const makeInterrupterKit = ({ console }) => {
  const signal = makePromiseKit();
  /** @type {Error | null} */
  let rejection = null;
  const onInterrupt = () => {
    if (rejection) {
      console.warn('Interruption already in progress');
    } else {
      rejection = new Error('Interrupted');
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
 *
 * @param {string} progName
 * @param {string[]} rawArgs
 * @param {Object} powers
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
  const argv = yargsParser(rawArgs);

  const { getProcessInfo, getCPUTimeOffset } = makeProcfsHelper({ fs, spawn });
  const { findByPrefix, dirDiskUsage, makeFIFO } = makeFsHelper({
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

  const { console: topConsole } = makeConsole();

  const outputDir = String(argv.outputDir || `results/run-${Date.now()}`);
  topConsole.log(`Outputting to ${resolvePath(outputDir)}`);
  await fs.mkdir(outputDir, { recursive: true });

  /** @type {typeof makeLocalChainTasks | typeof makeTestnetTasks} */
  let makeTasks;
  /** @type {string} */
  let testnetOrigin;

  switch (argv.profile) {
    case null:
    case undefined:
    case 'local':
      makeTasks = makeLocalChainTasks;
      testnetOrigin = '';
      break;
    case 'testnet':
    case 'stage':
      makeTasks = makeTestnetTasks;
      testnetOrigin =
        argv.testnetOrigin || `https://${argv.profile}.agoric.net`;
      break;
    default:
      throw new Error(`Unexpected profile option: ${argv.profile}`);
  }

  const { setupTasks, runChain, runClient, runLoadgen } = makeTasks({
    spawn,
    fs,
    findDirByPrefix: findByPrefix,
    makeFIFO,
    getProcessInfo,
  });

  const monitorInterval =
    Number(argv.monitorInterval || defaultMonitorIntervalMinutes) * 60 * 1000;

  let currentStage = -1;
  const timeSource = makeTimeSource({ performance });
  const cpuTimeOffset = await getCPUTimeOffset();
  const cpuTimeSource = timeSource.shift(0 - cpuTimeOffset);
  let currentStageTimeSource = timeSource;

  const outputStream = fsStream.createWriteStream(
    joinPath(outputDir, 'perf.jsonl'),
    { flags: 'wx' },
  );
  await fsStreamReady(outputStream);

  const runStats = makeRunStats();

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

  /**
   * @param {Object} config
   * @param {boolean} config.chainOnly
   * @param {number} config.durationConfig
   * @param {unknown} config.loadgenConfig
   * @param {boolean} config.withMonitor
   * @param {boolean} config.saveStorage
   */
  const runStage = async (config) => {
    const {
      chainOnly,
      durationConfig,
      loadgenConfig,
      withMonitor,
      saveStorage,
    } = config;
    /** @type {string | void} */
    let chainStorageLocation;
    currentStageTimeSource = timeSource.shift();

    const { out, err } = makeConsole(`stage-${currentStage}`);
    const { console: stageConsole } = makeConsole('runner', out, err);

    const { orInterrupt, releaseInterrupt } = makeInterrupterKit({
      console: stageConsole,
    });

    logPerfEvent('stage-start');
    const stageStart = timeSource.shift();

    const stats = runStats.newStage({
      stageIndex: currentStage,
      stageConfig: config,
    });

    /** @type {Task} */
    const spawnChain = async (nextStep) => {
      stageConsole.log('Running chain', config);
      logPerfEvent('run-chain-start');
      const runChainResult = await runChain({ stdout: out, stderr: err });
      logPerfEvent('run-chain-finish');
      stats.recordChainStart(timeSource.getTime());

      let chainExited = false;
      const done = runChainResult.done.finally(() => {
        chainExited = true;
        logPerfEvent('chain-stopped');
      });

      currentStageTimeSource = cpuTimeSource.shift(
        runChainResult.processInfo.startTimestamp,
      );
      chainStorageLocation = runChainResult.storageLocation;

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

      /** @type {import("./sdk/promise-kit.js").PromiseRecord<void>} */
      const firstBlockDoneKit = makePromiseKit();
      /** @type {(() => void) | null} */
      let resolveFirstBlockDone = firstBlockDoneKit.resolve;

      /** @type {import("./sdk/promise-kit.js").PromiseRecord<void>} */
      const firstEmptyBlockKit = makePromiseKit();
      /** @type {(() => void) | null} */
      let resolveFirstEmptyBlock = firstEmptyBlockKit.resolve;

      const notifier = {
        /** @param {import('./stats/types.js').BlockStats} block */
        blockDone(block) {
          if (resolveFirstBlockDone) {
            resolveFirstBlockDone();
            resolveFirstBlockDone = null;
          }

          if (resolveFirstEmptyBlock) {
            if (block.slogLines === 0 || stats.blockCount > 10) {
              if (block.slogLines === 0) {
                logPerfEvent('stage-first-empty-block', {
                  block: block.blockHeight,
                });
              }
              resolveFirstEmptyBlock();
              resolveFirstEmptyBlock = null;
            }
          }
        },
      };

      const chainMonitor = makeChainMonitor(runChainResult, {
        ...makeConsole('monitor-chain', out, err),
        logPerfEvent,
        cpuTimeSource,
        dirDiskUsage,
      });
      chainMonitor.start(monitorInterval);

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

          await Promise.race([
            slogMonitorDone,
            orInterrupt(firstBlockDoneKit.promise),
          ]);
          await orInterrupt(firstEmptyBlockKit.promise);

          await nextStep(done);
        },
        async () =>
          aggregateTryFinally(
            async () => {
              chainMonitor.stop();

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
      const runClientResult = await runClient({ stdout: out, stderr: err });
      logPerfEvent('run-client-finish');
      stats.recordClientStart(timeSource.getTime());

      let clientExited = false;
      const done = runClientResult.done.finally(() => {
        clientExited = true;
        logPerfEvent('client-stopped');
      });

      await aggregateTryFinally(
        async () => {
          await orInterrupt(runClientResult.ready);
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
        async () => {
          if (!clientExited) {
            stageConsole.log('Stopping client');

            runClientResult.stop();
            await done;
          }
        },
      );
    };

    /** @type {Task} */
    const spawnLoadgen = async (nextStep) => {
      stageConsole.log('Running load gen');
      logPerfEvent('run-loadgen-start');
      const runLoadgenResult = await runLoadgen({
        stdout: out,
        stderr: err,
        config: loadgenConfig,
      });
      stats.recordLoadgenStart(timeSource.getTime());
      logPerfEvent('run-loadgen-finish');

      let loadgenExited = false;
      const done = runLoadgenResult.done.finally(() => {
        loadgenExited = true;
        logPerfEvent('loadgen-stopped');
      });

      const monitorLoadgenDone = monitorLoadgen(runLoadgenResult, {
        ...makeConsole('monitor-loadgen', out, err),
        stats,
      });

      await aggregateTryFinally(
        async () => {
          await orInterrupt(runLoadgenResult.ready);
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

          await nextStep(done);
        },
        async () => {
          if (!loadgenExited) {
            stageConsole.log('Stopping loadgen');

            runLoadgenResult.stop();
            await done;
          }

          await monitorLoadgenDone;
        },
      );
    };

    /** @type {Task} */
    const stageReady = async (nextStep) => {
      /** @type {Promise<void>} */
      let sleeping;
      /** @type {import("./sdk/promise-kit.js").PromiseRecord<void>} */
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

        if (!chainOnly) {
          tasks.push(spawnClient, spawnLoadgen);
        }

        if (tasks.length === 1) {
          throw new Error('Nothing to do');
        } else {
          tasks.push(stageReady);
        }
        stats.recordStart(timeSource.getTime());
        await sequential(...tasks)((stop) => stop);
        stats.recordEnd(timeSource.getTime());
      },
      async () =>
        aggregateTryFinally(
          async () => {
            if (saveStorage && chainStorageLocation != null) {
              stageConsole.log('Saving chain storage');
              await childProcessDone(
                spawn('tar', [
                  '-cSJf',
                  joinPath(
                    outputDir,
                    `chain-storage-stage-${currentStage}.tar.xz`,
                  ),
                  chainStorageLocation,
                ]),
              );
            }
          },
          async () => {
            releaseInterrupt();

            logPerfEvent('stage-finish');
            currentStageTimeSource = timeSource;
          },
        ),
    );
  };

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
      {
        const { releaseInterrupt } = makeInterrupterKit({
          console: initConsole,
        });

        const reset = coerceBooleanOption(argv.reset, true);
        const setupConfig = {
          reset,
          chainOnly: globalChainOnly,
          withMonitor,
          testnetOrigin,
        };
        logPerfEvent('setup-tasks-start', setupConfig);
        await aggregateTryFinally(
          // Do not short-circuit on interrupt, let the spawned setup process terminate
          async () =>
            setupTasks({ stdout: out, stderr: err, config: setupConfig }),

          // This will throw if there was any interrupt, and prevent further execution
          async () => releaseInterrupt(),
        );
        logPerfEvent('setup-tasks-finish');
      }

      const stages =
        argv.stages != null
          ? parseInt(String(argv.stages), 10)
          : defaultNumberStages;

      const stageConfigs = coerceRecordOption(argv.stage);

      const sharedLoadgenConfig = coerceRecordOption(
        stageConfigs.loadgen,
        defaultLoadgenConfig,
      );

      const sharedStageDurationMinutes =
        stageConfigs.duration != null
          ? Number(stageConfigs.duration)
          : defaultStageDurationMinutes;

      while (currentStage < stages - 1) {
        currentStage += 1;

        const stageConfig = coerceRecordOption(stageConfigs[currentStage]);

        const withLoadgen = coerceBooleanOption(
          stageConfig.loadgen,
          globalChainOnly ? false : undefined,
          false,
        );

        const loadgenConfig =
          withLoadgen == null
            ? coerceRecordOption(stageConfig.loadgen, sharedLoadgenConfig)
            : sharedLoadgenConfig;

        // By default the first stage will only initialize the chain from genesis
        // and the last stage will only capture the chain restart time
        // loadgen and chainOnly options overide default
        const chainOnly =
          globalChainOnly ||
          coerceBooleanOption(
            stageConfig.chainOnly,
            withLoadgen != null
              ? !withLoadgen // use boolean loadgen option value as default chainOnly
              : loadgenConfig === sharedLoadgenConfig && // user provided stage loadgen config implies chain
                  withMonitor && // If monitor is disabled, chainOnly has no meaning
                  (currentStage === 0 || currentStage === stages - 1),
          );

        const saveStorage = coerceBooleanOption(
          stageConfig.saveStorage,
          !chainOnly || currentStage === 0,
        );

        const duration =
          (stageConfig.duration != null
            ? Number(stageConfig.duration)
            : (!(chainOnly && makeTasks === makeLocalChainTasks) &&
                sharedStageDurationMinutes) ||
              0) * 60;

        // eslint-disable-next-line no-await-in-loop
        await runStage({
          chainOnly,
          durationConfig: duration,
          loadgenConfig,
          withMonitor,
          saveStorage,
        });
      }

      runStats.recordEnd(timeSource.getTime());
    },
    async () => {
      logPerfEvent('finish', { stats: runStats });

      outputStream.end();

      await finished(outputStream);
    },
  );
};

export default main;
