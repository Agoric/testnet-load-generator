/* global process */

import { PromiseAllOrErrors } from './async.js';
import { asBuffer } from './stream.js';

/**
 * @param {import("child_process").ChildProcess} childProcess
 * @param {Object} [options]
 * @param {boolean} [options.ignoreExitCode] do not error on non-zero exit codes
 * @param {{signal: undefined | boolean | NodeJS.Signals} | boolean} [options.ignoreKill] do not error on null exit code
 *      If the value is an object, it's `signal`property can be updated and will be checked on exit
 * @param {number} [options.killedExitCode] Exit code to consider like `null` if killed
 * @returns {Promise<number>} The exit code of the process
 */
export const childProcessDone = (
  childProcess,
  { ignoreExitCode = false, ignoreKill = false, killedExitCode } = {},
) =>
  new Promise((resolve, reject) => {
    /**
     * @param {number | null} code
     * @param {NodeJS.Signals | null} signal
     */
    const onExit = (code, signal) => {
      // When code is non-`null`, signal is always `null` even if the process got killed

      if (
        code === null &&
        ignoreKill &&
        (ignoreKill === true ||
          ignoreKill.signal === true ||
          ignoreKill.signal === signal)
      ) {
        code = 0;
      }

      if (
        killedExitCode &&
        code === killedExitCode &&
        ignoreKill &&
        (ignoreKill === true || ignoreKill.signal)
      ) {
        code = 0;
      }

      if (code === 0 || ignoreExitCode) {
        resolve(code != null ? code : -1);
      } else {
        reject(new Error(`Process exited with non-zero code: ${code}`));
      }
    };

    if (childProcess.exitCode != null) {
      onExit(childProcess.exitCode, null);
      return;
    }
    childProcess.on('error', reject).on('exit', onExit);
  });

/**
 * @param {import("child_process").ChildProcess} childProcess
 * @returns {Promise<void>}
 */
export const childProcessReady = (childProcess) =>
  new Promise((resolve, reject) => {
    if (childProcess.pid !== undefined) {
      resolve();
      return;
    }
    childProcess.on('error', reject).on('spawn', resolve);
  });

/** @type {import('./types.js').ChildProcessOutput} */
export const childProcessOutput =
  /**
   * @param {import('./types.js').ChildProcessWithStreamOutput} childProcess
   * @param {(out: import('stream').Readable) => Promise<any>} [outHandler]
   */
  async (childProcess, outHandler = asBuffer) => {
    const [res] = await PromiseAllOrErrors([
      /** @type {(out: import("stream").Readable) => Promise<any>} */ (
        outHandler
      )(childProcess.stdout),
      childProcessDone(childProcess),
    ]);
    return res;
  };

/**
 * Makes a spawn that support non fd backed stdio streams
 * Automatically creates a pipe stdio and pipes the stream
 *
 * @param {Object} options
 * @param {import("child_process").spawn} options.spawn Node.js spawn
 * @param {boolean} [options.end] Pipe option to automatically forward stream end
 * @returns {import("child_process").spawn}
 */
export const makeSpawnWithPipedStream = ({ spawn, end }) => {
  /**
   * @param {string} command
   * @param {ReadonlyArray<string>} args
   * @param {import("child_process").SpawnOptions} options
   * @returns {import("child_process").ChildProcess}
   */
  const pipedSpawn = (command, args, options) => {
    const spawnOptions =
      typeof args === 'object' && args != null && !Array.isArray(args)
        ? /** @type {import("child_process").SpawnOptions} */ (args)
        : options || {};
    let { stdio } = spawnOptions;
    let stdin;
    let stdout;
    let stderr;
    if (Array.isArray(stdio)) {
      /** @type {(import("stream").Stream | undefined)[]} */
      const internalStdio = new Array(3);

      stdio = stdio.map((value, idx) => {
        if (
          idx < 3 &&
          typeof value === 'object' &&
          value != null &&
          typeof (/** @type {any} */ (value).fd) !== 'number'
        ) {
          internalStdio[idx] = value;
          return 'pipe';
        }
        return value;
      });

      [stdin, stdout, stderr] = internalStdio;
    }

    const childProcess =
      /** @type {import("child_process").ChildProcessWithoutNullStreams} */ (
        spawn(command, args, {
          ...spawnOptions,
          // @ts-ignore stdio can be undefined
          stdio,
        })
      );

    const endOption = end !== undefined ? { end } : {};

    if (stdin) {
      stdin.pipe(childProcess.stdin, endOption);
    }
    if (stdout) {
      childProcess.stdout.pipe(/** @type {*} */ (stdout), endOption);
    }
    if (stderr) {
      childProcess.stderr.pipe(/** @type {*} */ (stderr), endOption);
    }

    return /** @type {any} */ (childProcess);
  };

  // TODO: general covariance of return type allows our spawn to add stdio streams
  //       but NodeJS spawn overloads specifically disallow it
  return /** @type {*} */ (pipedSpawn);
};

/**
 * Makes a verbose spawn that prints out the executed command
 *
 * @template {import("child_process").spawn} S
 * @param {Object} options
 * @param {S} options.spawn Node.js spawn
 * @param {(cmd: string) => void} options.print
 * @returns {S}
 */
export const makePrinterSpawn = ({ spawn, print }) => {
  /**
   * @param {string} command
   * @param {ReadonlyArray<string> | import("child_process").SpawnOptions} [args]
   * @param {import("child_process").SpawnOptions} [options]
   * @returns {import("child_process").ChildProcess}
   */
  const printerSpawn = (command, args, options = {}) => {
    const env = (options.env !== process.env ? options.env : null) || {};
    const envPairs = Object.entries(
      // While prototype properties are used by spawn
      // don't clutter the print output with the "inherited" env
      Object.getOwnPropertyDescriptors(env),
    )
      .filter(([_, desc]) => desc.enumerable)
      .map(([name, desc]) => `${name}=${desc.value}`);

    const actualArgs = Array.isArray(args) ? args : [];

    print(`${[...envPairs, command, ...actualArgs].join(' ')}`);

    return spawn(command, /** @type {ReadonlyArray<string>} */ (args), options);
  };

  return /** @type {any} */ (printerSpawn);
};
