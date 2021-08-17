import { Console } from 'console';

import LineStreamTransform from './line-stream-transform.js';

/**
 * @param {Object} options
 * @param {import("stream").Writable} options.out
 * @param {import("stream").Writable} [options.err]
 * @param {string} [options.outPrefix]
 * @param {string} [options.errPrefix]
 * @param {boolean} [options.colorMode]
 */
export const makeOutputter = ({
  out,
  err = out,
  outPrefix,
  errPrefix = outPrefix,
  colorMode = true,
}) => {
  if (outPrefix) {
    const dstOut = out;
    out = new LineStreamTransform({
      prefix: outPrefix,
      lineEndings: true,
    });
    out.pipe(dstOut);
  }

  if (errPrefix) {
    const dstErr = err;
    err = new LineStreamTransform({
      prefix: errPrefix,
      lineEndings: true,
    });
    err.pipe(dstErr);
  }

  return {
    console: new Console({ stdout: out, stderr: err, colorMode }),
    out,
    err,
  };
};
