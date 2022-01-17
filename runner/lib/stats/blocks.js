/* eslint-disable prefer-object-spread */

import { makeRawStats, cloneData, copyProperties } from './helpers.js';

/** @typedef {import("./types.js").BlockStatsInitData} BlockStatsInitData */
/** @typedef {import("./types.js").BlockStats} BlockStats */

/**
 * @typedef {|
 *   'slogLines' |
 * never} RawBlockStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<BlockStats,RawBlockStatsProps>} */
const rawBlockStatsInit = {
  slogLines: {
    default: -Infinity,
    writeMulti: true,
  },
};

/**
 * @param {BlockStatsInitData} data
 * @returns {BlockStats}
 */
export const makeBlockStats = (data) => {
  const { publicProps, privateSetters } = makeRawStats(rawBlockStatsInit);

  /** @type {BlockStats['recordStart']} */
  const recordStart = () => {};

  let ended = false;

  /** @type {BlockStats['recordSwingsetStart']} */
  const recordSwingsetStart = () => {
    privateSetters.slogLines(0);
  };

  /** @type {BlockStats['recordSlogLine']} */
  const recordSlogLine = () => {
    if (!ended) {
      privateSetters.slogLines(publicProps.slogLines + 1);
    }
  };

  /** @type {BlockStats['recordEnd']} */
  const recordEnd = () => {
    // Finish line itself doesn't count
    privateSetters.slogLines(publicProps.slogLines - 1);
    ended = true;
  };

  const stats = harden(
    copyProperties(
      {
        recordStart,
        recordEnd,
        recordSwingsetStart,
        recordSlogLine,
      },
      cloneData(data),
      publicProps,
    ),
  );

  return stats;
};
