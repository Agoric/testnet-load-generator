import { makePromiseKit } from '@endo/promise-kit';
import chalk from 'chalk';
import { resolve as resolvePath, join as joinPath } from 'path';
import yargsParser from 'yargs-parser';

import makeSetup from './setup.js';

// @TODO: separate helpers in a standalone folder
import { aggregateTryFinally } from '../../runner/lib/helpers/async.js';
import { fsStreamReady, makeFsHelper } from '../../runner/lib/helpers/fs.js';
import { resolve as importMetaResolve } from '../../runner/lib/helpers/module.js';
import { makeOutputter } from '../../runner/lib/helpers/outputter.js';
import { makeProcfsHelper } from '../../runner/lib/helpers/procsfs.js';
import { makeTimeSource } from '../../runner/lib/helpers/time.js';
import { makeRunStats } from '../../runner/lib/stats/run.js';
import { makeGetEnvInfo } from '../../runner/lib/tasks/shared-env-info.js';

const allowedTracingOptions = ['xsnap', 'kvstore', 'swingstore'];
const defaultBootstrapConfigs = {
  base: '@agoric/vats/decentral-config.json',
  custom: undefined,
  demo: '@agoric/vats/decentral-demo-config.json',
  loadgen: '@agoric/vats/decentral-loadgen-config.json',
};
const perfReportFileName = 'perf.jsonl';
const profile = 'testnet';

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
      if (assertBool)
        throw new Error(`Unexpected boolean option value ${maybeBoolValue}`);
      return defaultValue;
  }
};

/**
 * @param {Partial<{base: string; custom: string; demo: string; loadgen: string;}>} bootstrapConfigs
 * @param {boolean} hasCustomBootstrapConfig
 * @param {{console: Console}} powers
 */
const getBootstrapConfig = (
  bootstrapConfigs,
  hasCustomBootstrapConfig,
  { console },
) =>
  Promise.all(
    Object.entries(bootstrapConfigs).map(async ([name, identifier]) => [
      name,
      identifier &&
        (await importMetaResolve(identifier, import.meta.url).catch(() => {})),
    ]),
  ).then((entries) => {
    /** @type {Record<keyof typeof defaultBootstrapConfigs, string | undefined>} */
    const { custom, loadgen, demo, base } = Object.fromEntries(entries);

    if (custom) return custom;
    else if (hasCustomBootstrapConfig)
      throw new Error('Custom bootstrap config missing');

    if (loadgen) return loadgen;
    else if (demo && !base) {
      console.warn('Loadgen bootstrap config missing, using demo.');
      return demo;
    } else
      return console.warn('Loadgen bootstrap config missing, using default.');
  });

const getSDKBinaries = () => ({
  agSolo: '',
  cosmosChain: 'ag-chain-cosmos',
  cosmosHelper: '',
});

/**
 * @param {yargsParser.Arguments} argv
 * @param {{console: Console}} powers
 */
const getTracingOptions = (argv, { console }) => {
  /** @type {import('../../runner/lib/tasks/types.js').CosmicSwingSetTracingKeys[]} */
  const tracing = [];

  if (argv.trace) {
    // If `--trace` is specified without values, enable all
    if (!argv.trace.length) argv.trace = allowedTracingOptions;

    // `--no-trace` results in `[ false ]`
    if (argv.trace.length === 0 && argv.trace[0] === false) argv.trace = [];

    if (!Array.isArray(argv.trace))
      throw new Error(`Invalid 'trace' option: ${argv.trace}`);

    for (const val of argv.trace) {
      if (!allowedTracingOptions.includes(val))
        console.log(`Ignoring 'trace' option value "${val}"`);
      else tracing.push(val);
    }
  }

  return tracing;
};

/**
 * @param {import("stream").Writable} err
 * @param {import("stream").Writable} out
 * @param {string} [prefix]
 */
const makeConsole = (err, out, prefix) =>
  makeOutputter({
    out,
    err,
    outPrefix: prefix && `${chalk.green(prefix)}: `,
    errPrefix: prefix && `${chalk.bold.red(prefix)}: `,
  });

/**
 * @param {object} powers
 * @param {Console} powers.console
 */
const makeInterrupterKit = ({ console }) => {
  const signal = makePromiseKit();
  /** @type {NodeJS.ErrnoException | null} */
  let rejection = null;

  const onExit = () => {
    throw new Error('Interrupt was not cleaned up');
  };

  const onInterrupt = () => {
    if (rejection) {
      console.warn('Interruption already in progress');
    } else {
      rejection = new Error('Interrupted');
      rejection.code = 'ERR_SCRIPT_EXECUTION_INTERRUPTED';
      signal.reject(rejection);
    }
  };

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

  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);
  process.on('exit', onExit);

  let orInterruptCalled = false;

  // Prevent unhandled rejection when orInterrupt is called after interruption
  signal.promise.catch(() => {});

  return { orInterrupt, releaseInterrupt };
};

/**
 *
 * @param {string} progName
 * @param {string[]} rawArgs
 * @param {object} powers
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {Pick<import("fs"), 'createReadStream' | 'createWriteStream'>} powers.fsStream Node.js fs stream operations
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("stream").Writable} powers.stderr
 * @param {import("stream").Writable} powers.stdout
 * @param {string} powers.tmpDir Directory location to place temporary files in
 */
const main = async (
  progName,
  rawArgs,
  { fs, fsStream, spawn, stderr, stdout, tmpDir },
) => {
  const argv = yargsParser(rawArgs, {
    array: ['trace'],
    configuration: {
      'duplicate-arguments-array': false,
      'flatten-duplicate-arrays': false,
      'greedy-arrays': true,
      'strip-dashed': true,
    },
  });

  const { console: rootConsole } = makeConsole(stderr, stdout);
  const { makeFIFO } = makeFsHelper({
    fs,
    fsStream,
    spawn,
    tmpDir,
  });
  const { getProcessInfo, getCPUTimeOffset } = makeProcfsHelper({ fs, spawn });
  const timeSource = makeTimeSource({ performance });

  const hasCustomBootstrapConfig = typeof argv.customBootstrap === 'string';
  const outputDir = resolvePath(argv.outputDir || `results/run-${Date.now()}`);
  const reset = coerceBooleanOption(argv.reset, true);

  const bootstrapConfigs = {
    ...defaultBootstrapConfigs,
    ...(hasCustomBootstrapConfig
      ? {
          custom: argv.customBootstrap,
        }
      : {}),
  };
  const useStateSync = coerceBooleanOption(argv.useStateSync, false);
  const withBootstrap = coerceBooleanOption(
    argv.customBootstrap,
    hasCustomBootstrapConfig,
    false,
  );

  const tracing = getTracingOptions(argv, { console: rootConsole });

  const outputStream = fsStream.createWriteStream(
    joinPath(outputDir, perfReportFileName),
    { flags: 'wx' },
  );

  /** @type {import('../../runner/lib/stats/types.js').LogPerfEvent} */
  const logPerfEvent = (eventType, data = {}) =>
    void outputStream.write(
      JSON.stringify(
        {
          time: undefined, // Placeholder to put data.time before type if it exists
          timestamp: timeSource.now(),
          type: `perf-${eventType}`,
          ...data,
        },
        (_, arg) =>
          typeof arg === BigInt.name.toLowerCase() ? Number(arg) : arg,
      ) + '\n',
    );

  /**
   * @param {'client' | 'chain'} role
   * @returns {import('../../runner/lib/tasks/types.js').TaskSwingSetOptions['trace']}
   */
  const makeTraceOption = (role) =>
    Object.fromEntries(
      tracing.map((val) => [val, `${outputDir}/${role}-${val}-trace`]),
    );

  const [cpuTimeOffset, loadgenBootstrapConfig] = await Promise.all([
    getCPUTimeOffset().catch(() => 0),
    !withBootstrap
      ? undefined
      : getBootstrapConfig(bootstrapConfigs, hasCustomBootstrapConfig, {
          console: rootConsole,
        }),
    fs.mkdir(outputDir, { recursive: true }),
    fsStreamReady(outputStream),
  ]);

  const { getEnvInfo, setupChain } = makeSetup({
    spawn,
    fs,
    makeFIFO,
    getProcessInfo,
    sdkBinaries: getSDKBinaries(),
    loadgenBootstrapConfig,
  });

  const envInfo = getEnvInfo({ stdout, stderr });

  rootConsole.log(`Outputting to ${outputDir}`);
  rootConsole.log(envInfo);

  const runStats = makeRunStats({
    metadata: {
      profile,
      testData: argv.testData,
      testnetOrigin: argv.testnetOrigin,
      useStateSync,
      ...envInfo,
    },
  });

  const cpuTimeSource = timeSource.shift(0 - cpuTimeOffset);

  rootConsole.log('argc: ', argv);

  await aggregateTryFinally(
    async () => {
      const {
        console: initConsole,
        out,
        err,
      } = makeConsole(stderr, stdout, 'init');
      runStats.recordStart(timeSource.getTime());

      logPerfEvent('start', {
        cpuTimeOffset,
        timeOrigin: timeSource.timeOrigin,
      });

      const { releaseInterrupt } = makeInterrupterKit({
        console: initConsole,
      });

      const chainStorageLocation = await aggregateTryFinally(
        () =>
          setupChain(
            {
              reset,
              testnetOrigin: argv.testnetOrigin,
              useStateSync,
            },
            {
              stdout: out,
              stderr: err,
            },
          ),

        () => releaseInterrupt(),
      );
      initConsole.log('chainStorageLocation: ', chainStorageLocation);
      logPerfEvent('setup-chain-finish');
    },
    async () => {},
  );
};

export default main;
