import { aggregateTryFinally } from './async.js';
import { childProcessDone } from './child-process.js';

/**
 * @param {string} source
 * @param {string} tmpSuffix
 * @param {string} destination
 * @param {object} powers
 * @param {import("child_process").spawn} powers.spawn
 */
export const backgroundCompressFolder = async (
  source,
  tmpSuffix,
  destination,
  { spawn },
) => {
  const tmp = `${source}${tmpSuffix}`;
  const cleanup = async () => void childProcessDone(spawn('rm', ['-rf', tmp]));

  try {
    await childProcessDone(spawn('cp', ['-a', '--reflink=auto', source, tmp]));
  } catch (err) {
    await aggregateTryFinally(cleanup, () => Promise.reject(err));
  }

  return {
    done: aggregateTryFinally(
      async () =>
        void childProcessDone(spawn('tar', ['-cSJf', destination, tmp])),
      cleanup,
    ),
  };
};
