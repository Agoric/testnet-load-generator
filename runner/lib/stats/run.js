/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeStatsCollection,
  makeGetters,
  cloneData,
  copyProperties,
} from './helpers.js';
import { makeStageStats } from './stages.js';

/** @typedef {import("./types.js").StageStats} StageStats */
/** @typedef {import("./types.js").RunStatsInitData} RunStatsInitData */
/** @typedef {import("./types.js").RunStats} RunStats */

/**
 * @typedef {|
 * never} RawRunStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<RunStats,RawRunStatsProps>} */
const rawRunStatsInit = {};

/**
 * @param {RunStatsInitData} data
 * @returns {RunStats}
 */
export const makeRunStats = (data = {}) => {
  const { publicProps } = makeRawStats(rawRunStatsInit);

  /** @type {import("./helpers.js").MakeStatsCollectionReturnType<number, StageStats>} */
  const {
    collection: stages,
    insert: insertStage,
    getCount: getStageCount,
  } = makeStatsCollection();

  /** @type {RunStats['newStage']} */
  const newStage = (stageData) => {
    const { stageIndex } = stageData;

    assert(stageIndex === getStageCount());

    const stageStats = makeStageStats(stageData);
    insertStage(stageIndex, stageStats);
    return stageStats;
  };

  const getBlockCount = () =>
    Object.values(stages).reduce(
      (acc, stage) => acc + (stage ? stage.blockCount : 0),
      0,
    );

  const stats = harden(
    copyProperties(
      {
        recordStart: () => {},
        recordEnd: () => {},
        newStage,
      },
      cloneData(data),
      publicProps,
      makeGetters({
        stages: () => stages,
        stageCount: getStageCount,
        blockCount: getBlockCount,
      }),
    ),
  );

  return stats;
};
