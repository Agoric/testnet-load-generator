import chalk from 'chalk';

// TODO: pass an "httpRequest" as power instead of importing
import http from 'http';

import { sleep } from './helpers/async.js';
import { makeOutputter } from './helpers/outputter.js';

/**
 * @param {string | URL} url
 * @param {http.RequestOptions & {body?: Buffer}} options
 * @returns {Promise<http.IncomingMessage>}
 */
export const httpRequest = (url, options) => {
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
export const untilArgv = async (info, retries = 50) => {
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
export const untilChildren = async (info, retries = 50) => {
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
export const getArgvMatcher = (argMatchers) => (argv) =>
  argv.every((arg, idx) => {
    const matcher = argMatchers[idx];
    return !matcher || matcher.test(arg);
  });

/**
 * @param {ArgvMatcher} argvMatcher
 * @returns {ArgvMatcher}
 */
export const wrapArgvMatcherIgnoreEnvShebang = (argvMatcher) => (argv) =>
  argvMatcher(argv) || (/env$/.test(argv[0]) && argvMatcher(argv.slice(1)));

/**
 * @param {import('./helpers/process-info.js').ProcessInfo} launcherInfo
 * @param {ArgvMatcher} argvMatcher
 */
export const getChildMatchingArgv = async (launcherInfo, argvMatcher) => {
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

/**
 * @param {string} prefix
 * @param {import("stream").Writable} stdout
 * @param {import("stream").Writable} stderr
 * @returns {{stdio: [undefined, import("stream").Writable, import("stream").Writable], console: Console}}
 */
export const getConsoleAndStdio = (prefix, stdout, stderr) => {
  const { console, out, err } = makeOutputter({
    out: stdout,
    err: stderr,
    outPrefix: prefix && `${chalk.bold.blue(prefix)}: `,
    errPrefix: prefix && `${chalk.bold.red(prefix)}: `,
  });
  return { console, stdio: [undefined, out, err] };
};
