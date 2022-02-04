/* global console */

import chalk from 'chalk';

// TODO: pass an "httpRequest" as power instead of importing
import http from 'http';
import https from 'https';
import fs from 'fs';

import { sleep } from '../helpers/async.js';
import { makeOutputter } from '../helpers/outputter.js';
import { fsStreamReady } from '../helpers/fs.js';
import { asJSON } from '../helpers/stream.js';

const protocolModules = {
  'http:': http,
  'https:': https,
};

/** @typedef {http.RequestOptions & {body?: Buffer}} HTTPRequestOptions */

/**
 * @template T
 * @param {AsyncIterable<T>} iterable
 * @returns {AsyncIterable<T>}
 */
export const cleanAsyncIterable = (iterable) => ({
  [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
});

/**
 * @param {string | URL} urlOrString
 * @param {HTTPRequestOptions} [options]
 * @returns {Promise<http.IncomingMessage>}
 */
export const httpRequest = (urlOrString, options = {}) => {
  return new Promise((resolve, reject) => {
    const url =
      typeof urlOrString === 'string' ? new URL(urlOrString) : urlOrString;

    if (url.protocol === 'file:') {
      const stream = fs.createReadStream(url.pathname);
      // Ugly cast hack to make res look like what the consumer cares about
      const res = /** @type {http.IncomingMessage} */ (
        harden(
          /** @type {unknown} */ ({
            ...cleanAsyncIterable(stream),
            statusCode: 200,
          }),
        )
      );
      resolve(fsStreamReady(stream).then(() => res));
      return;
    }

    if (!(url.protocol in protocolModules)) {
      throw new Error(`Invalid protocol ${url.protocol}`);
    }

    const protocolModule =
      protocolModules[/** @type {keyof protocolModules} */ (url.protocol)];

    const { body, ...httpOptions } = options;

    const req = protocolModule.request(url, httpOptions);
    req.on('response', resolve).on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
};

/**
 * @param {string} url
 * @param {HTTPRequestOptions} [options]
 * @returns {Promise<unknown>}
 */
export const fetchAsJSON = async (url, options) => {
  const res = await httpRequest(url, options);

  if (!res.statusCode || res.statusCode >= 400) {
    throw new Error(`HTTP request error: ${res.statusCode}`);
  }

  // TODO: Check `res.headers['content-type']` for type and charset
  return asJSON(res);
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
 * @param {import('../helpers/process-info.js').ProcessInfo} launcherInfo
 * @param {ArgvMatcher} argvMatcher
 * @param {number} [retries]
 * @returns {Promise<import('../helpers/process-info.js').ProcessInfo>}
 */
export const getChildMatchingArgv = async (
  launcherInfo,
  argvMatcher,
  retries = 50,
) => {
  const childrenWithArgv = await Promise.all(
    (
      await launcherInfo.getChildren()
    ).map(async (info) => ({
      info,
      argv: await info.getArgv(),
    })),
  );

  const result = childrenWithArgv.find(({ argv }) => argv && argvMatcher(argv));

  if (result) {
    return result.info;
  } else if (retries > 0) {
    await sleep(100);
    return getChildMatchingArgv(launcherInfo, argvMatcher, retries - 1);
  } else {
    console.error(
      `getChildMatchingArgv: ${
        childrenWithArgv.length
      } child process, none of ["${childrenWithArgv
        .map(({ argv }) => (argv || ['no argv']).join(' '))
        .join('", "')}"] match expected arguments`,
    );

    throw new Error("Couldn't find child process");
  }
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
