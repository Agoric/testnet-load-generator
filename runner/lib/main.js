/* global process setInterval clearInterval */
/* eslint-disable no-continue */

// import { Command } from 'commander';

import { resolve as resolvePath, join as joinPath, basename } from 'path';
import { performance } from 'perf_hooks';
import zlib from 'zlib';
import { promisify } from 'util';
import {
  pipeline as pipelineCallback,
  finished as finishedCallback,
} from 'stream';

import chalk from 'chalk';
import { makePromiseKit } from '@agoric/promise-kit';

import {
  sleep,
  PromiseAllOrErrors,
  warnOnRejection,
  aggregateTryFinally,
} from './helpers/async.js';
import { childProcessDone } from './helpers/child-process.js';
import { makeFsHelper } from './helpers/fs.js';
import { makeProcfsHelper } from './helpers/procsfs.js';
import { makeOutputter } from './helpers/outputter.js';

import { makeTestOperations } from './test-local-chain.js';

const pipeline = promisify(pipelineCallback);
const finished = promisify(finishedCallback);

const monitorInterval = 5 * 60 * 1000;

const stageDuration = 6 * 60 * 60 * 1000;

const vatIdentifierRE = /^(v\d+):(.*)$/;
const knownVatsNamesWithoutProcess = ['comms', 'vattp'];

/**
 * @typedef { |
 *    'create-vat' |
 *    'vat-startup-finish' |
 *    'replay-transcript-start' |
 *    'cosmic-swingset-end-block-start' |
 *    'cosmic-swingset-end-block-finish' |
 *    'cosmic-swingset-begin-block'
 * } SupportedSlogEventTypes
 */

/**
 * @typedef {{
 *   time: number,
 *   type: SupportedSlogEventTypes
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
 *   type: 'cosmic-swingset-end-block-start' |
 *         'cosmic-swingset-end-block-finish' |
 *         'cosmic-swingset-begin-block',
 *   vatID: string
 * } & Record<string, unknown>} SlogCosmicSwingsetEvent
 */

/** @type {SupportedSlogEventTypes[]} */
const supportedSlogEventTypes = [
  'create-vat',
  'vat-startup-finish',
  'replay-transcript-start',
  'cosmic-swingset-end-block-start',
  'cosmic-swingset-end-block-finish',
  'cosmic-swingset-begin-block',
];

const slogEventRE = new RegExp(
  `^{"time":\\d+(?:\\.\\d+),"type":"(?:${supportedSlogEventTypes.join('|')})"`,
);

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

  const outputDir = rawArgs[0] || `run-results-${Date.now()}`;

  const { getProcessInfo, getCPUTimeOffset } = makeProcfsHelper({ fs, spawn });
  const { findByPrefix, dirDiskUsage, makeFIFO } = makeFsHelper({
    fs,
    fsStream,
    spawn,
    tmpDir,
  });

  const { resetChain, runChain, runClient, runLoadGen } = makeTestOperations({
    spawn,
    findDirByPrefix: findByPrefix,
    makeFIFO,
    getProcessInfo,
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

  console.log(`Outputting to ${resolvePath(outputDir)}`);
  await fs.mkdir(outputDir, { recursive: true });

  const outputStream = fsStream.createWriteStream(
    joinPath(outputDir, 'perf.jsonl'),
  );

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
   * @param {import("./test-operations.js").RunChainInfo} chainInfo
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
        const argv = await info.getArgv(); // eslint-disable-line no-await-in-loop
        if (!argv || basename(argv[0]) !== 'xsnap') continue;
        const vatIdentifierMatches = vatIdentifierRE.exec(argv[1]);
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

        if (
          vatInfo.started &&
          !vatInfo.processInfo &&
          vatInfo.vatName &&
          !knownVatsNamesWithoutProcess.includes(vatInfo.vatName)
        ) {
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
          ...[...vatInfos].map(([vatID, { processInfo, vatName }]) => ({
            eventData: {
              processType: 'vat',
              vatID,
              name: vatName,
            },
            processInfo,
          })),
        ].map(async ({ eventData, processInfo }) => {
          if (!processInfo) return;
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
        }),
      ).then(() => {});

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
          } = /** @type {SlogCreateVatEvent} */ (event);
          if (!vatInfos.has(vatID)) {
            vatInfos.set(vatID, {
              vatName,
              processInfo: undefined,
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
        case 'cosmic-swingset-end-block-start': {
          if (event.blockHeight === 0) {
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
            warnOnRejection(
              logProcessUsage(),
              monitorConsole,
              'Failed to get initial process usage',
            );
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
   * @param {boolean} [param0.chainOnly]
   */
  const runStage = async ({ chainOnly } = {}) => {
    /** @type {import("stream").Writable} */
    let out;
    /** @type {import("stream").Writable} */
    let err;

    currentStage += 1;
    currentStageElapsedOffsetNs = performance.now() * 1000;
    ({ console, out, err } = makeConsole(`stage-${currentStage}`));

    const { console: stageConsole } = makeConsole('runner', out, err);

    logPerfEvent('stage-start');
    const stageStart = performance.now();

    stageConsole.log('Running chain');
    logPerfEvent('run-chain-start');
    const runChainResult = await runChain({ stdout: out, stderr: err });
    logPerfEvent('run-chain-finish');

    currentStageElapsedOffsetNs =
      (runChainResult.processInfo.startTimestamp - cpuTimeOffset) * 1e6;
    const chainStorageLocation = runChainResult.storageLocation;
    /** @type {import("@agoric/promise-kit").PromiseRecord<void>} */
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
        await runChainResult.ready;
        logPerfEvent('chain-ready');
        stageConsole.log('Chain ready');

        await chainFirstEmptyBlock;

        if (!chainOnly) {
          stageConsole.log('Running client');
          logPerfEvent('run-client-start');
          const runClientStart = performance.now();
          const runClientResult = await runClient({ stdout: out, stderr: err });
          logPerfEvent('run-client-finish');

          await aggregateTryFinally(
            async () => {
              await runClientResult.ready;
              logPerfEvent('client-ready', {
                duration:
                  Math.round((performance.now() - runClientStart) * 1000) / 1e6,
              });

              stageConsole.log('Running load gen');
              logPerfEvent('run-loadgen-start');
              const runLoadGenResult = await runLoadGen({
                stdout: out,
                stderr: err,
              });
              logPerfEvent('run-loadgen-finish');

              await aggregateTryFinally(
                async () => {
                  await runLoadGenResult.ready;
                  logPerfEvent('loadgen-ready');

                  const sleepTime = Math.max(
                    0,
                    stageDuration - (performance.now() - stageStart),
                  );
                  stageConsole.log(
                    'Stage ready, going to sleep for',
                    Math.round(sleepTime / (1000 * 60)),
                    'minutes',
                  );
                  logPerfEvent('stage-ready');

                  const signal = makePromiseKit();
                  const onInterrupt = () =>
                    signal.reject(new Error('Interrupted'));
                  process.once('SIGINT', onInterrupt);
                  process.once('SIGTERM', onInterrupt);

                  await aggregateTryFinally(
                    async () => {
                      await Promise.race([sleep(sleepTime), signal.promise]);
                      logPerfEvent('stage-shutdown');
                    },
                    async () => {
                      process.off('SIGINT', onInterrupt);
                      process.off('SIGTERM', onInterrupt);
                    },
                  );
                },
                async () => {
                  stageConsole.log('Stopping load-gen');

                  runLoadGenResult.stop();
                  await runLoadGenResult.done;
                  logPerfEvent('loadgen-stopped');
                },
              );
            },
            async () => {
              stageConsole.log('Stopping client');

              runClientResult.stop();
              await runClientResult.done;
              logPerfEvent('client-stopped');
            },
          );
        }
      },
      async () => {
        stageConsole.log('Stopping chain');

        runChainResult.stop();
        await runChainResult.done;
        logPerfEvent('chain-stopped');

        await PromiseAllOrErrors([
          childProcessDone(
            spawn('tar', [
              '-cSJf',
              joinPath(outputDir, `chain-storage-stage-${currentStage}.tar.xz`),
              chainStorageLocation,
            ]),
          ),
          monitorChainDone,
        ]);
      },
    );

    logPerfEvent('stage-finish');
    currentStageElapsedOffsetNs = 0;
  };

  // Main

  await aggregateTryFinally(
    async () => {
      let out;
      let err;
      ({ console, out, err } = makeConsole('init'));
      logPerfEvent('start', {
        cpuTimeOffset: await getCPUTimeOffset(),
        timeOrigin: performance.timeOrigin / 1000,
        // TODO: add other interesting info here
      });

      logPerfEvent('reset-chain-start');
      await resetChain({ stdout: out, stderr: err });
      logPerfEvent('reset-chain-finish');

      // Initialize the chain and restart
      await runStage({ chainOnly: true });

      // Run 4 load gen stages
      while (currentStage < 4) {
        await runStage(); // eslint-disable-line no-await-in-loop
      }

      // One final restart to capture the replay time
      await runStage({ chainOnly: true });
    },
    async () => {
      outputStream.end();

      await finished(outputStream);
    },
  );
};

export default main;
