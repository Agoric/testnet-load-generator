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
  makeSummer,
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

  const getCyclesSummary = () => {
    /** @type {import("./helpers.js").Summer<ReturnType<typeof cyclesSummerTransform>>} */
    const summer = makeSummer();

    for (const {
      cyclesSummaries: { all: stageCyclesSummary = undefined } = {},
    } of /** @type {StageStats[]} */ (Object.values(stages))) {
      if (stageCyclesSummary) {
        summer.add(
          cyclesSummerTransform(stageCyclesSummary),
          stageCyclesSummary.cycleCount,
        );
      }
    }

    return makeCycleStatsSummary(summer.getSums());
  };

  const getLiveBlocksSummary = () => {
    /** @type {import("./helpers.js").Summer<ReturnType<typeof blockSummerTransform>>} */
    const summer = makeSummer();

    for (const {
      blocksSummaries: { onlyLive: stageLiveBlocksSummary = undefined } = {},
    } of /** @type {StageStats[]} */ (Object.values(stages))) {
      if (stageLiveBlocksSummary) {
        summer.add(
          blockSummerTransform(stageLiveBlocksSummary),
          stageLiveBlocksSummary.blockCount,
        );
      }
    }

    return makeBlockStatsSummary(summer.getSums());
  };

  const getTotalBlockCount = () => {
    let blockCount = 0;

    for (const {
      blocksSummaries: { all: stageAllBlocksSummary = undefined } = {},
    } of /** @type {StageStats[]} */ (Object.values(stages))) {
      if (stageAllBlocksSummary) {
        blockCount += stageAllBlocksSummary.blockCount;
      }
    }

    return blockCount;
  };

  const updateSummaries = () => {
    privateSetters.cyclesSummary(getCyclesSummary());
    privateSetters.liveBlocksSummary(getLiveBlocksSummary());
    privateSetters.totalBlockCount(getTotalBlockCount());
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
