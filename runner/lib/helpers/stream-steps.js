import { promisify } from 'util';
import { finished as finishedCallback } from 'stream';

import { makePromiseKit } from '../sdk/promise-kit.js';

import LineStreamTransform from './line-stream-transform.js';

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
