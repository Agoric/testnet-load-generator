/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeGetters,
  cloneData,
  copyProperties,
  rounder,
  percentageRounder,
} from './helpers.js';

/** @typedef {import("./types.js").CycleStatsInitData} CycleStatsInitData */
/** @typedef {import("./types.js").CycleStats} CycleStats */
/** @typedef {import("./types.js").StageStats} StageStats */

/**
 * @typedef {|
 *   'success' |
 *   'startBlockHeight'|
 *   'endBlockHeight' |
 *   'startedAt' |
 *   'endedAt' |
 * never} RawCycleStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<CycleStats,RawCycleStatsProps>} */
const rawCycleStatsInit = {
  success: null,
  startBlockHeight: null,
  endBlockHeight: null,
  startedAt: null,
  endedAt: null,
};

/** @typedef {'success' | 'blockCount' | 'duration'} CycleStatsSumKeys */

/**
 * @param {import('./helpers.js').Summary<CycleStatsSumKeys>} sums
 * @returns {import('./types.js').CycleStatsSummary | undefined}
 */
export const makeCycleStatsSummary = ({
  weights: cycleCount,
  averages,
  p95s,
}) =>
  cycleCount
    ? {
        cycleCount,
        cycleSuccessRate: percentageRounder(averages.success),
        avgBlockCount: rounder(averages.blockCount),
        avgDuration: rounder(averages.duration),
        p95BlockCount: rounder(p95s.blockCount),
        p95Duration: rounder(p95s.duration),
      }
    : undefined;

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
  const { savedData, publicProps, privateSetters } =
    makeRawStats(rawCycleStatsInit);

  /** @type {CycleStats['recordStart']} */
  const recordStart = (time) => {
    privateSetters.startedAt(time);
    if (stageStats) {
      privateSetters.startBlockHeight(stageStats.lastBlockHeight);
    }
  };

  /** @type {CycleStats['recordEnd']} */
  const recordEnd = (time, successResult) => {
    privateSetters.endedAt(time);
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

  const getDuration = () =>
    savedData.startedAt &&
    savedData.endedAt &&
    rounder(savedData.endedAt - savedData.startedAt);

  return harden(
    copyProperties(
      {
        recordStart,
        recordEnd,
      },
      cloneData(data),
      publicProps,
      makeGetters({ blockCount: getBlockCount, duration: getDuration }),
    ),
  );
};
