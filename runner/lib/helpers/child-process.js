/* global process */

/**
 * @param {import("child_process").ChildProcess} childProcess
 * @param {Object} [options]
 * @param {boolean} [options.ignoreExitCode] do not error on non-zero exit codes
 * @returns {Promise<number>} The exit code of the process
 */
export const childProcessDone = (
  childProcess,
  { ignoreExitCode = false } = {},
) =>
  new Promise((resolve, reject) =>
    childProcess.on('error', reject).on('exit', (code) => {
      if (!ignoreExitCode && (code == null || code !== 0)) {
        reject(new Error(`Process exited with non-zero code: ${code}`));
      } else {
        resolve(code != null ? code : -1);
      }
    }),
  );

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

    const childProcess = spawn(command, args, {
      ...spawnOptions,
      stdio,
    });

    if (stdin) {
      stdin.pipe(/** @type {NodeJS.WritableStream} */ (childProcess.stdin), {
        end,
      });
    }
    if (stdout) {
      /** @type {NodeJS.ReadableStream} */ (childProcess.stdout).pipe(
        /** @type {*} */ (stdout),
        {
          end,
        },
      );
    }
    if (stderr) {
      /** @type {NodeJS.ReadableStream} */ (childProcess.stderr).pipe(
        /** @type {*} */ (stderr),
        { end },
      );
    }

    return /** @type {any} */ (childProcess);
  };

  // TODO: general covariance of return type allows our spawn to add stdio streams
  //       but NodeJS spawn overloads specifically disallow it
  return /** @type {*} */ (pipedSpawn);
};

/**
 * @callback PipedSpawn
 * @param {string} command
 * @param {ReadonlyArray<string>} args
 * @param {import("child_process").SpawnOptionsWithStdioTuple<'ignore' | undefined, import("stream").Writable, import("stream").Writable>} options
 * @returns {import("child_process").ChildProcessByStdio<null, import("stream").Readable, import("stream").Readable>}
 */

/**
 * Makes a verbose spawn that requires a writable stream for stdout and stderr,
 * prints out the executed command and pipes child process streams
 *
 * @param {Object} options
 * @param {import("child_process").spawn} options.spawn Node.js spawn
 * @param {boolean} [options.end] Pipe option to automatically forward stream end
 * @returns {PipedSpawn}
 */
export const makeSpawnWithPrintAndPipeOutput = ({ spawn, end }) => {
  const spawnWithPipe = makeSpawnWithPipedStream({ spawn, end });

  return (command, args, options) => {
    const env = (options.env !== process.env ? options.env : null) || {};
    const envPairs = Object.entries(
      // While prototype properties are used by spawn
      // don't clutter the print output with the "inherited" env
      Object.getOwnPropertyDescriptors(env),
    )
      .filter(([_, desc]) => desc.enumerable)
      .map(([name, desc]) => `${name}=${desc.value}`);

    const [_, out, err, ...others] = options.stdio;

    out.write(`${[...envPairs, command, ...args].join(' ')}\n`);

    const childProcess = spawnWithPipe(command, args, {
      ...options,
      stdio: ['ignore', out, err, ...others],
    });

    // The childProcess does include the out and err streams but spawnWithPipe doesn't have the correct return type
    return /** @type {*} */ (childProcess);
  };
};
