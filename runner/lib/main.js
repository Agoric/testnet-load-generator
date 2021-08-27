/* global process setInterval clearInterval */
/* eslint-disable no-continue */

import { resolve as resolvePath, join as joinPath, basename } from 'path';
import { performance } from 'perf_hooks';
import zlib from 'zlib';
import { promisify } from 'util';
import {
  pipeline as pipelineCallback,
  finished as finishedCallback,
} from 'stream';

import yargsParser from 'yargs-parser';
import chalk from 'chalk';
import { makePromiseKit } from './sdk/promise-kit.js';

import {
  sleep,
  PromiseAllOrErrors,
  warnOnRejection,
  aggregateTryFinally,
  sequential,
} from './helpers/async.js';
import { childProcessDone } from './helpers/child-process.js';
import { makeFsHelper } from './helpers/fs.js';
import { makeProcfsHelper } from './helpers/procsfs.js';
import { makeOutputter } from './helpers/outputter.js';

import { makeTasks as makeLocalChainTasks } from './tasks/local-chain.js';
import { makeTasks as makeTestnetTasks } from './tasks/testnet.js';

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

const vatIdentifierRE = /^(v\d+):(.*)$/;

/**
 * @typedef { |
 *    'cosmic-swingset-bootstrap-block-start' |
 *    'cosmic-swingset-bootstrap-block-finish' |
 *    'cosmic-swingset-end-block-start' |
 *    'cosmic-swingset-end-block-finish' |
 *    'cosmic-swingset-begin-block'
 * } SlogCosmicSwingsetEventTypes
 */

/**
 * @typedef { |
 *    'create-vat' |
 *    'vat-startup-finish' |
 *    'replay-transcript-start' |
 *    SlogCosmicSwingsetEventTypes
 * } SlogSupportedEventTypes
 */

/**
 * @typedef {{
 *   time: number,
 *   type: SlogSupportedEventTypes
 * }} SlogEventBase
 */

/**
 * @typedef {SlogEventBase & Record<string, unknown>} SlogEvent
 */

/**
 * @typedef {{
 *   time: number,
 *   type: 'create-vat',
 *   vatID: string,
 *   name?: string,
 *   dynamic: boolean,
 *   managerType: "local" | "xs-worker" | string,
 * } & Record<string, unknown>} SlogCreateVatEvent
 */

/**
 * @typedef {{
 *   time: number,
 *   type: 'vat-startup-finish' | 'replay-transcript-start',
 *   vatID: string
 * } & Record<string, unknown>} SlogVatEvent
 */

/**
 * @typedef {{
 *   time: number,
 *   type: SlogCosmicSwingsetEventTypes,
 *   blockHeight?: number,
 *   blockTime: number
 * } & Record<string, unknown>} SlogCosmicSwingsetEvent
 */

/** @type {SlogSupportedEventTypes[]} */
const supportedSlogEventTypes = [
  'create-vat',
  'vat-startup-finish',
  'replay-transcript-start',
  'cosmic-swingset-bootstrap-block-start',
  'cosmic-swingset-bootstrap-block-finish',
  'cosmic-swingset-end-block-start',
  'cosmic-swingset-end-block-finish',
  'cosmic-swingset-begin-block',
];

const slogEventRE = new RegExp(
  `^{"time":\\d+(?:\\.\\d+),"type":"(?:${supportedSlogEventTypes.join('|')})"`,
);

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

const makeInterrupterKit = () => {
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

  let { console } = makeConsole();

  const outputDir = String(argv.outputDir || `results/run-${Date.now()}`);
  console.log(`Outputting to ${resolvePath(outputDir)}`);
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

  const outputStream = fsStream.createWriteStream(
    joinPath(outputDir, 'perf.jsonl'),
  );

  const monitorInterval =
    Number(argv.monitorInterval || defaultMonitorIntervalMinutes) * 60 * 1000;

  let currentStage = -1;
  let currentStageElapsedOffsetNs = 0;
  const cpuTimeOffset = await getCPUTimeOffset();

  /**
   *
   * @param {string} eventType
   * @param {Record<string, unknown>} [data]
   */
  const logPerfEvent = (eventType, data = {}) => {
    const perfNowNs = performance.now() * 1000;
    outputStream.write(
      JSON.stringify(
        {
          timestamp: Math.round(perfNowNs) / 1e6,
          stage: currentStage,
          elapsed: Math.round(perfNowNs - currentStageElapsedOffsetNs) / 1e6,
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
   * @param {import("./tasks/types.js").RunChainInfo} chainInfo
   * @param {Object} param1
   * @param {() => void} param1.resolveFirstEmptyBlock
   * @param {import("stream").Writable} param1.out
   * @param {import("stream").Writable} param1.err
   */
  const monitorChain = async (
    { slogLines, storageLocation, processInfo: kernelProcessInfo },
    { resolveFirstEmptyBlock, out, err },
  ) => {
    const { console: monitorConsole } = makeConsole('monitor-chain', out, err);

    /**
     * @typedef {{
     *    processInfo: import("./helpers/procsfs.js").ProcessInfo | null | undefined,
     *    vatName: string | undefined,
     *    local: boolean,
     *    started: boolean,
     *  }} VatInfo
     */
    /** @type {Map<string, VatInfo>} */
    const vatInfos = new Map();
    let vatUpdated = Promise.resolve();

    const updateVatInfos = async () => {
      monitorConsole.log('Updating vat infos');
      const childrenInfos = new Set(
        await kernelProcessInfo.getChildren().catch(() => []),
      );
      for (const info of childrenInfos) {
        const vatArgv = await info.getArgv(); // eslint-disable-line no-await-in-loop
        if (!vatArgv || basename(vatArgv[0]).slice(0, 2) !== 'xs') continue;
        const vatIdentifierMatches = vatIdentifierRE.exec(vatArgv[1]);
        if (!vatIdentifierMatches) continue;
        const vatID = vatIdentifierMatches[1];
        const vatInfo = vatInfos.get(vatID);

        if (!vatInfo) {
          /** @type {string | undefined} */
          let vatName = vatIdentifierMatches[2];
          if (!vatName || vatName === 'undefined') vatName = undefined;
          // TODO: warn found vat process without create event
          monitorConsole.warn(
            `found vat ${vatID}${
              vatName ? ` ${vatName}` : ''
            } process before create event`,
            'pid=',
            info.pid,
          );
          // vatInfo = { vatName, processInfo: info };
          // vatInfos.set(vatID, vatInfo);
          continue;
        }

        if (vatInfo.processInfo !== info) {
          // TODO: warn if replacing with new processInfo ?
        }

        vatInfo.processInfo = info;

        // if (!vatInfo.started) {
        //   monitorConsole.warn(
        //     `found vat ${vatID}${
        //       vatInfo.vatName ? ` ${vatInfo.vatName}` : ''
        //     } process before vat start event`,
        //     'pid=',
        //     info.pid,
        //   );
        // }
      }
      for (const [vatID, vatInfo] of vatInfos) {
        if (vatInfo.processInfo && !childrenInfos.has(vatInfo.processInfo)) {
          vatInfo.processInfo = null;
        }

        if (vatInfo.started && !vatInfo.local && !vatInfo.processInfo) {
          // Either the vat started but the process doesn't exist yet (undefined)
          // or the vat process exited but the vat didn't stop yet (null)
          monitorConsole.warn(
            `Vat ${vatID} started but process ${
              vatInfo.processInfo === null
                ? 'exited early'
                : "doesn't exist yet"
            }`,
          );
        }
      }
    };

    const ensureVatInfoUpdated = async () => {
      const vatUpdatedBefore = vatUpdated;
      await vatUpdated;
      if (vatUpdated === vatUpdatedBefore) {
        vatUpdated = updateVatInfos();
        warnOnRejection(
          vatUpdated,
          monitorConsole,
          'Failed to update vat process infos',
        );
        await vatUpdated;
      }
    };

    const logProcessUsage = async () =>
      PromiseAllOrErrors(
        [
          {
            eventData: {
              processType: 'kernel',
            },
            processInfo: kernelProcessInfo,
          },
          ...[...vatInfos]
            .filter(([, { local }]) => !local)
            .map(([vatID, { processInfo, vatName }]) => ({
              eventData: {
                processType: 'vat',
                vatID,
                name: vatName,
              },
              processInfo,
            })),
        ].map(async ({ eventData, processInfo }) => {
          if (!processInfo) {
            console.warn('missing process', eventData);
            return false;
          }
          const { times, memory } = await processInfo.getUsageSnapshot();
          logPerfEvent('chain-process-usage', {
            ...eventData,
            real:
              Math.round(
                performance.now() * 1000 -
                  (processInfo.startTimestamp - cpuTimeOffset) * 1e6,
              ) / 1e6,
            ...times,
            ...memory,
          });
          return true;
        }),
      ).then((results) => {
        if (results.some((result) => result === false)) {
          throw new Error('Missing vat processes.');
        }
      });

    const logStorageUsage = async () => {
      logPerfEvent('chain-storage-usage', {
        chain: await dirDiskUsage(storageLocation),
      });
    };

    const monitorIntervalId = setInterval(
      () =>
        warnOnRejection(
          PromiseAllOrErrors([logStorageUsage(), logProcessUsage()]),
          monitorConsole,
          'Failure during usage monitoring',
        ),
      monitorInterval,
    );

    const slogOutput = zlib.createGzip({
      level: zlib.constants.Z_BEST_COMPRESSION,
    });
    const slogOutputWriteStream = fsStream.createWriteStream(
      joinPath(outputDir, `chain-stage-${currentStage}.slog.gz`),
    );
    // const slogOutput = slogOutputWriteStream;
    // const slogOutputPipeResult = finished(slogOutput);
    const slogOutputPipeResult = pipeline(slogOutput, slogOutputWriteStream);

    /** @type {number | null}  */
    let slogStart = null;

    let slogBlocksSeen = 0;
    let slogEmptyBlocksSeen = 0;
    let slogLinesInBlock = 0;

    for await (const line of slogLines) {
      slogOutput.write(line);
      slogOutput.write('\n');

      if (slogStart == null) {
        // TODO: figure out a better way
        // There is a risk we could be late to the party here, with the chain
        // having started some time before us but in reality we usually find
        // the process before it starts the kernel
        slogStart = performance.now() / 1000;
        warnOnRejection(
          logStorageUsage(),
          monitorConsole,
          'Failed to get first storage usage',
        );
      }

      slogLinesInBlock += 1;

      // Avoid JSON parsing lines we don't care about
      if (!slogEventRE.test(line)) continue;

      const localEventTime = performance.timeOrigin + performance.now();

      /** @type {SlogEvent} */
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        monitorConsole.warn('Failed to parse slog line', line, error);
        continue;
      }

      monitorConsole.log(
        'slog event',
        event.type,
        'delay',
        Math.round(localEventTime - event.time * 1000),
        'ms',
      );

      switch (event.type) {
        case 'create-vat': {
          const {
            vatID,
            name: vatName,
            managerType,
          } = /** @type {SlogCreateVatEvent} */ (event);
          if (!vatInfos.has(vatID)) {
            vatInfos.set(vatID, {
              vatName,
              processInfo: undefined,
              local: managerType === 'local',
              started: false,
            });
          } else {
            // TODO: warn already created vat before
          }
          break;
        }
        case 'vat-startup-finish': {
          const { vatID } = /** @type {SlogVatEvent} */ (event);
          const vatInfo = vatInfos.get(vatID);
          if (!vatInfo) {
            // TODO: warn unknown vat
          } else {
            vatInfo.started = true;
            ensureVatInfoUpdated();
          }
          break;
        }
        case 'replay-transcript-start': {
          const { vatID } = /** @type {SlogVatEvent} */ (event);
          const vatInfo = vatInfos.get(vatID);
          if (!vatInfo) {
            // TODO: warn unknown vat
          } else if (!vatInfo.processInfo) {
            ensureVatInfoUpdated();
          }
          break;
        }
        case 'cosmic-swingset-bootstrap-block-start': {
          logPerfEvent('chain-first-init-start');
          break;
        }
        case 'cosmic-swingset-bootstrap-block-finish': {
          logPerfEvent('chain-first-init-finish');
          break;
        }
        case 'cosmic-swingset-end-block-start': {
          if (event.blockHeight === 0) {
            // Before https://github.com/Agoric/agoric-sdk/pull/3491
            // bootstrap didn't have it's own slog entry
            logPerfEvent('chain-first-init-start');
          }
          slogLinesInBlock = 0;
          break;
        }
        case 'cosmic-swingset-end-block-finish': {
          if (event.blockHeight === 0) {
            // TODO: measure duration from start to finish
            logPerfEvent('chain-first-init-finish');
          }
          // Finish line doesn't count
          slogLinesInBlock -= 1;
          if (slogLinesInBlock === 0) {
            if (!slogEmptyBlocksSeen) {
              logPerfEvent('stage-first-empty-block', {
                block: event.blockHeight,
              });
              resolveFirstEmptyBlock();
            }
            slogEmptyBlocksSeen += 1;
          }
          monitorConsole.log(
            'end-block',
            event.blockHeight,
            'linesInBlock=',
            slogLinesInBlock,
          );
          break;
        }
        case 'cosmic-swingset-begin-block': {
          if (!slogBlocksSeen) {
            logPerfEvent('stage-first-block', { block: event.blockHeight });
            await vatUpdated;
            await logProcessUsage().catch((usageErr) => {
              // Abuse first empty block as it will be awaited before monitorChain
              // And won't abruptly end our monitor
              // @ts-ignore resolving with a rejected promise is still "void" ;)
              resolveFirstEmptyBlock(Promise.reject(usageErr));
            });
          }
          slogBlocksSeen += 1;
          monitorConsole.log('begin-block', event.blockHeight);
          break;
        }
        default:
      }
    }

    clearInterval(monitorIntervalId);

    slogOutput.end();
    await slogOutputPipeResult;
  };

  /**
   * @param {Object} param0
   * @param {boolean} param0.chainOnly
   * @param {number} param0.duration
   * @param {unknown} param0.loadgenConfig
   * @param {boolean} param0.withMonitor
   * @param {boolean} param0.saveStorage
   */
  const runStage = async ({
    chainOnly,
    duration,
    loadgenConfig,
    withMonitor,
    saveStorage,
  }) => {
    /** @type {import("stream").Writable} */
    let out;
    /** @type {import("stream").Writable} */
    let err;

    /** @type {string | void} */
    let chainStorageLocation;
    currentStageElapsedOffsetNs = performance.now() * 1000;
    ({ console, out, err } = makeConsole(`stage-${currentStage}`));

    const { console: stageConsole } = makeConsole('runner', out, err);

    const { orInterrupt, releaseInterrupt } = makeInterrupterKit();

    logPerfEvent('stage-start');
    const stageStart = performance.now();

    /** @type {Task} */
    const spawnChain = async (nextStep) => {
      stageConsole.log('Running chain', { chainOnly, duration, loadgenConfig });
      logPerfEvent('run-chain-start');
      const runChainResult = await runChain({ stdout: out, stderr: err });
      logPerfEvent('run-chain-finish');

      let chainExited = false;
      const done = runChainResult.done.finally(() => {
        chainExited = true;
        logPerfEvent('chain-stopped');
      });

      currentStageElapsedOffsetNs =
        (runChainResult.processInfo.startTimestamp - cpuTimeOffset) * 1e6;
      chainStorageLocation = runChainResult.storageLocation;
      /** @type {import("./sdk/promise-kit.js").PromiseRecord<void>} */
      const {
        promise: chainFirstEmptyBlock,
        resolve: resolveFirstEmptyBlock,
      } = makePromiseKit();
      const monitorChainDone = monitorChain(runChainResult, {
        resolveFirstEmptyBlock,
        out,
        err,
      });

      await aggregateTryFinally(
        async () => {
          await orInterrupt(runChainResult.ready);
          logPerfEvent('chain-ready');
          stageConsole.log('Chain ready');

          await orInterrupt(chainFirstEmptyBlock);

          await nextStep(done);
        },
        async () => {
          if (!chainExited) {
            stageConsole.log('Stopping chain');

            runChainResult.stop();
            await done;
          }

          await monitorChainDone;
        },
      );
    };

    /** @type {Task} */
    const spawnClient = async (nextStep) => {
      stageConsole.log('Running client');
      logPerfEvent('run-client-start');
      const runClientStart = performance.now();
      const runClientResult = await runClient({ stdout: out, stderr: err });
      logPerfEvent('run-client-finish');

      let clientExited = false;
      const done = runClientResult.done.finally(() => {
        clientExited = true;
        logPerfEvent('client-stopped');
      });

      await aggregateTryFinally(
        async () => {
          await orInterrupt(runClientResult.ready);
          logPerfEvent('client-ready', {
            duration:
              Math.round((performance.now() - runClientStart) * 1000) / 1e6,
          });

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
      logPerfEvent('run-loadgen-finish');

      let loadgenExited = false;
      const done = runLoadgenResult.done.finally(() => {
        loadgenExited = true;
        logPerfEvent('loadgen-stopped');
      });

      await aggregateTryFinally(
        async () => {
          await orInterrupt(runLoadgenResult.ready);
          logPerfEvent('loadgen-ready');

          await nextStep(done);
        },
        async () => {
          if (!loadgenExited) {
            stageConsole.log('Stopping loadgen');

            runLoadgenResult.stop();
            await done;
          }
        },
      );
    };

    /** @type {Task} */
    const stageReady = async (nextStep) => {
      /** @type {Promise<void>} */
      let sleeping;
      if (duration < 0) {
        // sleeping forever
        sleeping = new Promise(() => {});
        stageConsole.log('Stage ready, waiting for end of chain');
      } else {
        const sleepTime = Math.max(
          0,
          duration - (performance.now() - stageStart),
        );
        if (sleepTime) {
          sleeping = sleep(sleepTime);
          stageConsole.log(
            'Stage ready, going to sleep for',
            Math.round(sleepTime / (1000 * 60)),
            'minutes',
          );
        } else {
          sleeping = Promise.resolve();
          stageConsole.log('Stage ready, no time to sleep, moving on');
        }
      }
      logPerfEvent('stage-ready');
      await nextStep(sleeping);
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

        await sequential(...tasks)((stop) => stop);
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
            currentStageElapsedOffsetNs = 0;
          },
        ),
    );
  };

  // Main

  await aggregateTryFinally(
    async () => {
      /** @type {import("stream").Writable} */
      let out;
      /** @type {import("stream").Writable} */
      let err;
      ({ console, out, err } = makeConsole('init'));
      logPerfEvent('start', {
        cpuTimeOffset: await getCPUTimeOffset(),
        timeOrigin: performance.timeOrigin / 1000,
        // TODO: add other interesting info here
      });

      const withMonitor = coerceBooleanOption(argv.monitor, true);
      const globalChainOnly = coerceBooleanOption(argv.chainOnly, undefined);
      {
        const { releaseInterrupt } = makeInterrupterKit();

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
              0) *
          60 *
          1000;

        // eslint-disable-next-line no-await-in-loop
        await runStage({
          chainOnly,
          duration,
          loadgenConfig,
          withMonitor,
          saveStorage,
        });
      }
    },
    async () => {
      outputStream.end();

      await finished(outputStream);
    },
  );
};

export default main;
