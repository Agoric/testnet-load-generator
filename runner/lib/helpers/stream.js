/* global Buffer */

import { promisify } from 'util';
import { finished as finishedCallback, PassThrough } from 'stream';

import { makePromiseKit } from '../sdk/promise-kit.js';

import LineStreamTransform from './line-stream-transform.js';
import ElidedBufferLineTransform from './elided-buffer-line-transform.js';
import BufferLineTransform from './buffer-line-transform.js';

const finished = promisify(finishedCallback);

/**
 * @typedef {Object} StepConfig
 * @property {RegExp} matcher
 * @property {number} [resultIndex=1] the index in the match result to use as resolution
 */

/**
 * @param {import("stream").Readable} stream
 * @param {StepConfig[]} steps
 * @param {Object} [options]
 * @param {boolean} [options.waitEnd=true]
 */
export const whenStreamSteps = (stream, steps, { waitEnd = true } = {}) => {
  const stepsAndKits = steps.map((step) => ({ step, kit: makePromiseKit() }));

  const lines = new LineStreamTransform();
  // const pipeResult = pipeline(stream, lines);
  stream.pipe(lines);

  const parseResult = (async () => {
    for await (const line of lines) {
      if (stepsAndKits.length) {
        const match = stepsAndKits[0].step.matcher.exec(line);
        if (match) {
          const stepAndKit = /** @type {{step: StepConfig, kit: import('../sdk/promise-kit.js').PromiseRecord<any>}} */ (stepsAndKits.shift());
          const {
            step: { resultIndex = 1 },
            kit: { resolve },
          } = stepAndKit;
          resolve(match[resultIndex]);
        }
      }

      if (!stepsAndKits.length) {
        stream.unpipe(lines);
        lines.end();
      }
    }

    if (stepsAndKits.length) {
      const error = new Error('Stream ended before match found');
      stepsAndKits.forEach(({ kit: { reject } }) => reject(error));
    }

    if (waitEnd) {
      await finished(stream);
    }
  })();

  return [...stepsAndKits.map(({ kit: { promise } }) => promise), parseResult];
};

/**
 *
 * @param {[unknown, import("stream").Readable, import("stream").Readable, ...unknown[]]} stdioIn
 * @param {[unknown, import("stream").Writable, import("stream").Writable, ...unknown[]]} stdioOut
 * @param {boolean} [elide]
 * @param {Promise<void>} [stop]
 */
export const combineAndPipe = (stdioIn, stdioOut, elide = true, stop) => {
  const combinedOutput = new PassThrough();
  const outLines = new (elide
    ? ElidedBufferLineTransform
    : BufferLineTransform)();
  const errLines = new (elide
    ? ElidedBufferLineTransform
    : BufferLineTransform)();
  stdioIn[1].pipe(stdioOut[1], { end: false });
  stdioIn[1].pipe(outLines).pipe(combinedOutput);
  stdioIn[2].pipe(stdioOut[2], { end: false });
  stdioIn[2].pipe(errLines).pipe(combinedOutput);
  if (stop) {
    Promise.resolve(stop).finally(() => {
      stdioIn[1].unpipe(outLines);
      stdioIn[2].unpipe(errLines);
      combinedOutput.end();
    });
  }

  return combinedOutput;
};

/**
 * @param {AsyncIterable<Buffer>} res
 */
export const asBuffer = async (res) => {
  const chunks = [];
  for await (const chunk of res) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

/**
 * @param {AsyncIterable<Buffer>} res
 */
export const asJSON = async (res) => {
  const buffer = await asBuffer(res);
  return JSON.parse(buffer.toString('utf-8'));
};
