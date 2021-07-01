/* global process Buffer */

import chalk from 'chalk';

import { dirname } from 'path';
import { promisify } from 'util';
import { PassThrough, pipeline as pipelineCallback } from 'stream';

// TODO: pass an "httpRequest" as power instead of importing
import http from 'http';

import {
  childProcessDone,
  makeSpawnWithPrintAndPipeOutput,
} from './helpers/child-process.js';
import LineStreamTransform from './helpers/line-stream-transform.js';
import { PromiseAllOrErrors, sleep, tryTimeout } from './helpers/async.js';
import { makeOutputter } from './helpers/outputter.js';
import { whenStreamSteps } from './helpers/stream-steps.js';

const pipeline = promisify(pipelineCallback);

/**
 * @param {string | URL} url
 * @param {http.RequestOptions & {body?: Buffer}} options
 * @returns {Promise<http.IncomingMessage>}
 */
const httpRequest = (url, options) => {
  return new Promise((resolve, reject) => {
    const { body, ...httpOptions } = options;

    const req = http.request(url, httpOptions);
    req.on('response', resolve).on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
};

/**
 *
 * @param {import('./helpers/process-info.js').ProcessInfo} info
 * @param {number} [retries]
 * @returns {Promise<string[] | null>}
 */
const untilArgv = async (info, retries = 50) => {
  const argv = await info.getArgv();
  return (
    argv ||
    (retries > 0 ? (await sleep(100), untilArgv(info, retries - 1)) : null)
  );
};

/**
 *
 * @param {import('./helpers/process-info.js').ProcessInfo} info
 * @param {number} [retries]
 * @returns {Promise<import('./helpers/process-info.js').ProcessInfo[]>}
 */
const untilChildren = async (info, retries = 50) => {
  const children = await info.getChildren();
  return children.length || retries === 0
    ? children
    : (await sleep(100), untilChildren(info, retries - 1));
};

/** @typedef {(argv: string[]) => boolean} ArgvMatcher */

/**
 * @param {(RegExp | null | undefined)[]} argMatchers
 * @returns {ArgvMatcher}
 */
const getArgvMatcher = (argMatchers) => (argv) =>
  argv.every((arg, idx) => {
    const matcher = argMatchers[idx];
    return !matcher || matcher.test(arg);
  });

/**
 * @param {ArgvMatcher} argvMatcher
 * @returns {ArgvMatcher}
 */
const wrapArgvMatcherIgnoreEnvShebang = (argvMatcher) => (argv) =>
  argvMatcher(argv) || (/env$/.test(argv[0]) && argvMatcher(argv.slice(1)));

/**
 * @param {import('./helpers/process-info.js').ProcessInfo} launcherInfo
 * @param {ArgvMatcher} argvMatcher
 */
const getChildMatchingArgv = async (launcherInfo, argvMatcher) => {
  const childrenWithArgv = await Promise.all(
    (await untilChildren(launcherInfo)).map(async (info) => ({
      info,
      argv: await untilArgv(info),
    })),
  );

  const result = childrenWithArgv.find(({ argv }) => argv && argvMatcher(argv));

  if (result) {
    return result.info;
  }

  console.error(
    `getChildMatchingArgv: ${
      childrenWithArgv.length
    } child process, none of ["${childrenWithArgv
      .map(({ argv }) => (argv || ['no argv']).join(' '))
      .join('", "')}"] match expected arguments`,
  );

  throw new Error("Couldn't find child process");
};

const chainDirPrefix = '_agstate/agoric-servers/local-chain-';

const chainStartRE = /ag-chain-cosmos start --home=(.*)$/;
const chainBlockBeginRE = /block-manager: block (\d+) begin$/;
const clientStartRE = /\bsolo\b\S+entrypoint\.[cm]?js start/;
const clientWalletReadyRE = /(?:Deployed Wallet!|Don't need our provides: wallet)/;
const loadgenStartRE = /deploy.*loadgen\/loop\.js/;
const loadgenReadyRE = /server running/;

const chainNodeArgvMatcher = wrapArgvMatcherIgnoreEnvShebang(
  getArgvMatcher([/node$/, /chain-entrypoint/]),
);
const chainGoArgvMatcher = getArgvMatcher([/(?:sh|node)$/, /ag-chain-cosmos$/]);
/** @param {string[]} argv */
const chainArgvMatcher = (argv) =>
  chainNodeArgvMatcher(argv) || chainGoArgvMatcher(argv);
const clientArgvMatcher = wrapArgvMatcherIgnoreEnvShebang(
  getArgvMatcher([/node$/, /\bsolo\b\S+entrypoint\.[cm]?js/]),
);

/**
 *
 * @param {Object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("./helpers/fs.js").MakeFIFO} powers.makeFIFO Make a FIFO file readable stream
 * @param {import("./helpers/fs.js").FindByPrefix} powers.findDirByPrefix
 * @param {import("./helpers/procsfs.js").GetProcessInfo} powers.getProcessInfo
 * @returns {import("./test-operations.js").TestOperations}
 *
 */
export const makeTestOperations = ({
  spawn,
  findDirByPrefix,
  makeFIFO,
  getProcessInfo,
}) => {
  const spawnPrintAndPipeOutput = makeSpawnWithPrintAndPipeOutput({
    spawn,
    end: false,
  });

  /**
   * @param {string} prefix
   * @param {import("stream").Writable} stdout
   * @param {import("stream").Writable} stderr
   * @returns {{stdio: [undefined, import("stream").Writable, import("stream").Writable], console: Console}}
   */
  const getConsoleAndStdio = (prefix, stdout, stderr) => {
    const { console, out, err } = makeOutputter({
      out: stdout,
      err: stderr,
      outPrefix: prefix && `${chalk.bold.blue(prefix)}: `,
      errPrefix: prefix && `${chalk.bold.red(prefix)}: `,
    });
    return { console, stdio: [undefined, out, err] };
  };

  return harden({
    setupTest: async ({ stdout, stderr, config = {} }) => {
      const { console, stdio } = getConsoleAndStdio(
        'setup-test',
        stdout,
        stderr,
      );

      console.log('Starting');

      const { reset } = /** @type {{reset?: boolean}} */ (config);

      if (reset) {
        console.log('Resetting state');
        const stateDir = dirname(chainDirPrefix);
        await childProcessDone(
          spawnPrintAndPipeOutput('rm', ['-rf', stateDir], { stdio }),
        );
        await childProcessDone(
          spawnPrintAndPipeOutput('git', ['checkout', '--', stateDir], {
            stdio,
          }),
        );
      }
      await childProcessDone(
        spawnPrintAndPipeOutput('agoric', ['install'], { stdio }),
      );

      console.log('Done');
    },
    runChain: async ({ stdout, stderr, timeout = 30 }) => {
      const { console, stdio } = getConsoleAndStdio('chain', stdout, stderr);

      console.log('Starting chain');

      const slogFifo = await makeFIFO('chain.slog');
      const slogLines = new LineStreamTransform();
      const slogPipeResult = pipeline(slogFifo, slogLines);

      const chainEnv = Object.create(process.env);
      chainEnv.SLOGFILE = slogFifo.path;

      const launcherCp = spawnPrintAndPipeOutput(
        'agoric',
        ['start', 'local-chain', '--verbose'],
        { stdio, env: chainEnv, detached: true },
      );

      let stopped = false;

      // Chain exit with code 98 when killed
      const chainDone = childProcessDone(launcherCp, {
        ignoreExitCode: true,
      }).then((code) => {
        if (code !== 0 && (!stopped || code !== 98)) {
          return Promise.reject(
            new Error(`Chain exited with non-zero code: ${code}`),
          );
        }
        return 0;
      });

      chainDone.then(
        () => console.log('Chain exited successfully'),
        (error) => console.error('Chain exited with error', error),
      );

      const [chainStarted, firstBlock, outputParsed] = whenStreamSteps(
        launcherCp.stdout,
        [
          { matcher: chainStartRE },
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

      return tryTimeout(
        timeout * 1000,
        async () => {
          await chainStarted;

          console.log('Chain running');

          const [storageLocation, processInfo] = await PromiseAllOrErrors([
            chainStarted.then(findDirByPrefix),
            getProcessInfo(
              /** @type {number} */ (launcherCp.pid),
            ).then((launcherInfo) =>
              getChildMatchingArgv(launcherInfo, chainArgvMatcher),
            ),
          ]);

          const stop = () => {
            stopped = true;
            process.kill(processInfo.pid);
          };

          return harden({
            stop,
            done,
            ready: firstBlock,
            slogLines: {
              [Symbol.asyncIterator]: () => slogLines[Symbol.asyncIterator](),
            },
            storageLocation,
            processInfo,
          });
        },
        async () => {
          // Avoid unhandled rejections for promises that can no longer be handled
          Promise.allSettled([done, firstBlock]);
          launcherCp.kill();
          slogFifo.close();
        },
      );
    },
    runClient: async ({ stdout, stderr, timeout = 20 }) => {
      const { console, stdio } = getConsoleAndStdio('client', stdout, stderr);

      console.log('Starting client');

      const launcherCp = spawnPrintAndPipeOutput(
        'agoric',
        ['start', 'local-solo'],
        { stdio, detached: true },
      );

      const clientDone = childProcessDone(launcherCp);

      clientDone.then(
        () => console.log('Client exited successfully'),
        (error) => console.error('Client exited with error', error),
      );

      const [clientStarted, walletReady, outputParsed] = whenStreamSteps(
        launcherCp.stdout,
        [
          { matcher: clientStartRE, resultIndex: -1 },
          { matcher: clientWalletReadyRE, resultIndex: -1 },
        ],
        {
          waitEnd: false,
        },
      );

      const done = PromiseAllOrErrors([
        outputParsed,
        clientDone,
      ]).then(() => {});

      return tryTimeout(
        timeout * 1000,
        async () => {
          await clientStarted;

          console.log('Client running');

          const processInfo = await getProcessInfo(
            /** @type {number} */ (launcherCp.pid),
          ).then((launcherInfo) =>
            getChildMatchingArgv(launcherInfo, clientArgvMatcher),
          );

          const stop = () => process.kill(processInfo.pid);

          return harden({
            stop,
            done,
            ready: walletReady,
          });
        },
        async () => {
          // Avoid unhandled rejections for promises that can no longer be handled
          Promise.allSettled([done, walletReady]);
          launcherCp.kill();
        },
      );
    },
    runLoadgen: async ({ stdout, stderr, timeout = 10, config = {} }) => {
      const { console, stdio } = getConsoleAndStdio('loadgen', stdout, stderr);

      console.log('Starting load gen');

      const loadgenEnv = Object.create(process.env);
      // loadgenEnv.DEBUG = 'agoric';

      const launcherCp = spawnPrintAndPipeOutput(
        'agoric',
        ['deploy', 'loadgen/loop.js'],
        { stdio, env: loadgenEnv, detached: true },
      );

      let stopped = false;
      const stop = () => {
        stopped = true;
        launcherCp.kill();
      };

      // Load gen exit with non-zero code when killed
      const loadgenDone = childProcessDone(launcherCp).catch((err) =>
        stopped ? 0 : Promise.reject(err),
      );

      loadgenDone.then(
        () => console.log('Load gen app stopped successfully'),
        (error) => console.error('Load gen app stopped with error', error),
      );

      // The agoric deploy output is currently sent to stderr
      // Combine both stderr and stdout in to detect both steps
      // accommodating future changes
      const combinedOutput = new PassThrough();
      const outLines = new LineStreamTransform({ lineEndings: true });
      const errLines = new LineStreamTransform({ lineEndings: true });
      launcherCp.stdout.pipe(outLines).pipe(combinedOutput);
      launcherCp.stderr.pipe(errLines).pipe(combinedOutput);

      const [deploying, tasksReady, outputParsed] = whenStreamSteps(
        combinedOutput,
        [{ matcher: loadgenStartRE }, { matcher: loadgenReadyRE }],
        {
          waitEnd: false,
        },
      );

      const cleanCombined = () => {
        launcherCp.stdout.unpipe(outLines);
        launcherCp.stderr.unpipe(errLines);
      };
      outputParsed.then(cleanCombined, cleanCombined);

      const done = PromiseAllOrErrors([
        outputParsed,
        loadgenDone,
      ]).then(() => {});

      return tryTimeout(
        timeout * 1000,
        async () => {
          await deploying;

          console.log('Load gen app running');

          const ready = tasksReady.then(async () => {
            console.log('Making request to start faucet');
            const body = Buffer.from(JSON.stringify(config), 'utf8');

            const res = await httpRequest('http://127.0.0.1:3352/config', {
              body,
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.byteLength,
              },
            });
            // Consume and discard the response
            for await (const _ of res);

            if (!res.statusCode || res.statusCode >= 400) {
              throw new Error('Could not start faucet');
            }
          });

          return harden({
            stop,
            done,
            ready,
          });
        },
        async () => {
          // Avoid unhandled rejections for promises that can no longer be handled
          Promise.allSettled([loadgenDone, tasksReady]);
          launcherCp.kill();
        },
      );
    },
  });
};
