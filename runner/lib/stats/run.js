/* eslint-disable prefer-object-spread */

import { makeBlockStatsSummary } from './blocks.js';
import { makeCycleStatsSummary } from './cycles.js';
import {
  makeRawStats,
  makeStatsCollection,
  makeGetters,
  cloneData,
  copyProperties,
  rounder,
  summarize,
  notUndefined,
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
 *   'totalBlockCount' |
 *   'liveBlocksSummary' |
 *   'cyclesSummary' |
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
  totalBlockCount: { default: 0, writeMulti: true },
  liveBlocksSummary: { writeMulti: true },
  cyclesSummary: { writeMulti: true },
};

/** @param {import('./types.js').BlockStatsSummary} blockStatsSummary */
const blockSummerTransform = ({
  liveMode,
  startBlockHeight,
  endBlockHeight,
  avgLag,
  avgBlockDuration,
  avgChainBlockDuration,
  avgIdleTime,
  avgCosmosTime,
  avgSwingsetTime,
  avgProcessingTime,
  avgDeliveries,
  avgComputrons,
  avgSwingsetPercentage,
  avgProcessingPercentage,
}) => ({
  liveMode: liveMode !== undefined ? Number(liveMode) : undefined,
  startBlockHeight,
  endBlockHeight,
  lag: avgLag,
  blockDuration: avgBlockDuration,
  chainBlockDuration: avgChainBlockDuration,
  idleTime: avgIdleTime,
  cosmosTime: avgCosmosTime,
  swingsetTime: avgSwingsetTime,
  processingTime: avgProcessingTime,
  swingsetPercentage: avgSwingsetPercentage,
  processingPercentage: avgProcessingPercentage,
  deliveries: avgDeliveries,
  computrons: avgComputrons,
});

/** @param {import('./types.js').CycleStatsSummary} cycleStatsSummary */
const cyclesSummerTransform = ({
  cycleSuccessRate,
  avgBlockCount,
  avgDuration,
}) => ({
  success: cycleSuccessRate / 100,
  blockCount: avgBlockCount,
  duration: avgDuration,
});

/** @param {import("./types.js").StatsCollection<number, StageStats>} stages */
export const getCyclesSummary = (stages) => {
  const sumData = Object.values(stages)
    .map(
      (stageStats) =>
        stageStats &&
        stageStats.cyclesSummaries &&
        stageStats.cyclesSummaries.all,
    )
    .filter(notUndefined)
    .map((stageCyclesSummary) => ({
      values: cyclesSummerTransform(stageCyclesSummary),
      weight: stageCyclesSummary.cycleCount,
    }));

  return makeCycleStatsSummary(summarize(sumData));
};

/** @param {import("./types.js").StatsCollection<number, StageStats>} stages */
export const getLiveBlocksSummary = (stages) => {
  const sumData = Object.values(stages)
    .map(
      (stageStats) =>
        stageStats &&
        stageStats.blocksSummaries &&
        stageStats.blocksSummaries.onlyLive,
    )
    .filter(notUndefined)
    .map((stageLiveBlocksSummary) => ({
      values: blockSummerTransform(stageLiveBlocksSummary),
      weight: stageLiveBlocksSummary.blockCount,
    }));

  return makeBlockStatsSummary(summarize(sumData));
};

/** @param {import("./types.js").StatsCollection<number, StageStats>} stages */
export const getTotalBlockCount = (stages) => {
  const blockCount = Object.values(stages)
    .map(
      (stageStats) =>
        stageStats &&
        stageStats.blocksSummaries &&
        stageStats.blocksSummaries.all,
    )
    .filter(notUndefined)
    .reduce(
      (acc, stageAllBlocksSummary) => acc + stageAllBlocksSummary.blockCount,
      0,
    );

  return blockCount;
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

  const updateSummaries = () => {
    privateSetters.cyclesSummary(getCyclesSummary(stages));
    privateSetters.liveBlocksSummary(getLiveBlocksSummary(stages));
    privateSetters.totalBlockCount(getTotalBlockCount(stages));
  };

  /** @type {RunStats['recordEnd']} */
  const recordEnd = (time) => {
    privateSetters.endedAt(time);

    updateSummaries();
  };

  /** @type {RunStats['newStage']} */
  const newStage = (stageData) => {
    const { stageIndex } = stageData;

    assert(stageIndex === getStageCount());

    updateSummaries();

    const stageStats = makeStageStats({
      ...stageData,
      previousCycleCount: publicProps.cyclesSummary
        ? publicProps.cyclesSummary.cycleCount
        : 0,
    });
    insertStage(stageIndex, stageStats);
    return stageStats;
  };

  const getDuration = () =>
    savedData.startedAt &&
    savedData.endedAt &&
    rounder(savedData.endedAt - savedData.startedAt);

  const getChainBootstrapStartedAt = () =>
    stages[0] && stages[0].chainStartedAt;
  const getChainBootstrapEndedAt = () => stages[0] && stages[0].chainReadyAt;
  const getChainBootstrapDuration = () =>
    stages[0] && stages[0].chainInitDuration;

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
        recordEnd,
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
        duration: getDuration,
        chainBootstrapStartedAt: getChainBootstrapStartedAt,
        chainBootstrapEndedAt: getChainBootstrapEndedAt,
        chainBootstrapDuration: getChainBootstrapDuration,
        walletDeployDuration: getWalletDeployDuration,
        loadgenDeployDuration: getLoadgenDeployDuration,
      }),
    ),
  );

  return stats;
};
