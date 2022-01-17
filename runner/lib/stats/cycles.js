/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeGetters,
  cloneData,
  copyProperties,
} from './helpers.js';

/** @typedef {import("./types.js").CycleStatsInitData} CycleStatsInitData */
/** @typedef {import("./types.js").CycleStats} CycleStats */
/** @typedef {import("./types.js").StageStats} StageStats */

/**
 * @typedef {|
 *   'success' |
 *   'startBlockHeight'|
 *   'endBlockHeight' |
 * never} RawCycleStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<CycleStats,RawCycleStatsProps>} */
const rawCycleStatsInit = {
  success: null,
  startBlockHeight: null,
  endBlockHeight: null,
};

/**
 * @param {CycleStatsInitData} data
 * @returns {import('./types.js').CycleStatsCollectionKey}
 */
export const makeCycleStatsKey = ({ task, seq }) => `${task}/${seq}`;

/**
 * @param {CycleStatsInitData} data
 * @param {StageStats} [stageStats]
 * @returns {CycleStats}
 */
export const makeCycleStats = (data, stageStats) => {
  const { savedData, publicProps, privateSetters } = makeRawStats(
    rawCycleStatsInit,
  );

  /** @type {CycleStats['recordStart']} */
  const recordStart = () => {
    if (stageStats) {
      privateSetters.startBlockHeight(stageStats.lastBlockHeight);
    }
  };

  /** @type {CycleStats['recordEnd']} */
  const recordEnd = (successResult) => {
    if (stageStats) {
      privateSetters.endBlockHeight(stageStats.lastBlockHeight);
    }
    assert(typeof successResult === 'boolean');
    privateSetters.success(successResult);
  };

  const getBlockCount = () =>
    savedData.startBlockHeight &&
    savedData.endBlockHeight &&
    savedData.endBlockHeight - savedData.startBlockHeight;

  return harden(
    copyProperties(
      {
        recordStart,
        recordEnd,
      },
      cloneData(data),
      publicProps,
      makeGetters({ blockCount: getBlockCount }),
    ),
  );
};
