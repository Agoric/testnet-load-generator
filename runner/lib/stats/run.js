/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeStatsCollection,
  makeGetters,
  cloneData,
  copyProperties,
  rounder,
} from './helpers.js';
import { makeStageStats } from './stages.js';

/** @typedef {import("./types.js").StageStats} StageStats */
/** @typedef {import("./types.js").RunStatsInitData} RunStatsInitData */
/** @typedef {import("./types.js").RunStats} RunStats */

/**
 * @typedef {|
 *   'startedAt' |
 *   'endedAt' |
 *   'walletDeployStartedAt' |
 *   'walletDeployEndedAt' |
 *   'loadgenDeployStartedAt' |
 *   'loadgenDeployEndedAt' |
 * never} RawRunStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<RunStats,RawRunStatsProps>} */
const rawRunStatsInit = {
  startedAt: null,
  endedAt: null,
  walletDeployStartedAt: null,
  walletDeployEndedAt: null,
  loadgenDeployStartedAt: null,
  loadgenDeployEndedAt: null,
};

/**
 * @param {RunStatsInitData} data
 * @returns {RunStats}
 */
export const makeRunStats = (data) => {
  const { savedData, publicProps, privateSetters } = makeRawStats(
    rawRunStatsInit,
  );

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

  const getCycleCount = () =>
    Object.values(stages).reduce(
      (acc, stage) => acc + (stage ? stage.cycleCount : 0),
      0,
    );

  const getDuration = () =>
    savedData.startedAt &&
    savedData.endedAt &&
    rounder(savedData.endedAt - savedData.startedAt);

  const getWalletDeployDuration = () =>
    savedData.walletDeployStartedAt &&
    savedData.walletDeployEndedAt &&
    rounder(savedData.walletDeployEndedAt - savedData.walletDeployStartedAt);

  const getLoadgenDeployDuration = () =>
    savedData.loadgenDeployStartedAt &&
    savedData.loadgenDeployEndedAt &&
    rounder(savedData.loadgenDeployEndedAt - savedData.loadgenDeployStartedAt);

  const stats = harden(
    copyProperties(
      {
        recordStart: privateSetters.startedAt,
        recordEnd: privateSetters.endedAt,
        recordWalletDeployStart: privateSetters.walletDeployStartedAt,
        recordWalletDeployEnd: privateSetters.walletDeployEndedAt,
        recordLoadgenDeployStart: privateSetters.loadgenDeployStartedAt,
        recordLoadgenDeployEnd: privateSetters.loadgenDeployEndedAt,
        newStage,
      },
      cloneData(data),
      publicProps,
      makeGetters({
        stages: () => stages,
        stageCount: getStageCount,
        blockCount: getBlockCount,
        cycleCount: getCycleCount,
        duration: getDuration,
        walletDeployDuration: getWalletDeployDuration,
        loadgenDeployDuration: getLoadgenDeployDuration,
      }),
    ),
  );

  return stats;
};
