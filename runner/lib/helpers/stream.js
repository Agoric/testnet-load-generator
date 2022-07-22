/* global Buffer */

import { promisify } from 'util';
import { finished as finishedCallback, PassThrough } from 'stream';

import { makePromiseKit } from '../sdk/promise-kit.js';

import LineStreamTransform from './line-stream-transform.js';
import ElidedBufferLineTransform from './elided-buffer-line-transform.js';
import BufferLineTransform from './buffer-line-transform.js';

const finished = promisify(finishedCallback);

/**
 * @typedef {object} StepConfig
 * @property {RegExp} matcher
 * @property {number} [resultIndex=1] the index in the match result to use as resolution
 */

/**
 * @param {import("stream").Readable} stream
 * @param {StepConfig[]} steps
 * @param {object} [options]
 * @param {boolean} [options.waitEnd=true]
 * @param {boolean} [options.close=true]
 */
export const whenStreamSteps = (
  stream,
  steps,
  { waitEnd = true, close = true } = {},
) => {
  const stepsAndKits = steps.map((step) => ({ step, kit: makePromiseKit() }));

  const lines = new LineStreamTransform();
  // const pipeResult = pipeline(stream, lines);
  stream.pipe(lines);

  const parseResult = (async () => {
    for await (const line of lines) {
      if (stepsAndKits.length) {
        const match = stepsAndKits[0].step.matcher.exec(line);
        if (match) {
          const stepAndKit =
            /** @type {{step: StepConfig, kit: import('../sdk/promise-kit.js').PromiseRecord<any>}} */ (
              stepsAndKits.shift()
            );
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
    } else if (close) {
      stream.destroy();
    }
  })();

  return [...stepsAndKits.map(({ kit: { promise } }) => promise), parseResult];
};

/**
 *
 * @param {[unknown, import("stream").Readable, import("stream").Readable, ...unknown[]]} stdioIn
 * @param {[unknown, import("stream").Writable, import("stream").Writable, ...unknown[]]} stdioOut
 * @param {boolean} [elide]
 * @returns {import("stream").Readable}
 */
export const combineAndPipe = (stdioIn, stdioOut, elide = true) => {
  const combinedOutput = new PassThrough();
  const outLines = new (
    elide ? ElidedBufferLineTransform : BufferLineTransform
  )();
  const errLines = new (
    elide ? ElidedBufferLineTransform : BufferLineTransform
  )();

  stdioIn[1].pipe(outLines);
  outLines.pipe(stdioOut[1], { end: false });
  outLines.pipe(combinedOutput, { end: false });
  stdioIn[2].pipe(errLines);
  errLines.pipe(stdioOut[2], { end: false });
  errLines.pipe(combinedOutput, { end: false });

  let active = 2;
  const sourceEnd = () => {
    if (!active) return;

    active -= 1;

    if (!active) {
      combinedOutput.end();
    }
  };
  outLines.once('end', sourceEnd);
  errLines.once('end', sourceEnd);
  combinedOutput.once('finish', () => {
    combinedOutput.destroy();
  });
  combinedOutput.once('close', () => {
    outLines.unpipe(combinedOutput);
    errLines.unpipe(combinedOutput);
    active = 0;
  });

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
