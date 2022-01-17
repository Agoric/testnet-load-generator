/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeStatsCollection,
  cloneData,
  makeGetters,
  copyProperties,
  rounder,
  arrayGroupBy,
  makeSummer,
} from './helpers.js';
import { makeBlockStats, makeBlockStatsSummary } from './blocks.js';
import {
  makeCycleStats,
  makeCycleStatsKey,
  makeCycleStatsSummary,
} from './cycles.js';

/** @typedef {import("./types.js").BlockStats} BlockStats */
/** @typedef {import("./types.js").CycleStats} CycleStats */
/** @typedef {import("./types.js").CycleStatsCollectionKey} CycleStatsCollectionKey */
/** @typedef {import("./types.js").StageStatsInitData} StageStatsInitData */
/** @typedef {import("./types.js").StageStats} StageStats */

/**
 * @typedef {|
 *   'blocksSummaries' |
 *   'cyclesSummaries' |
 *   'firstBlockHeight' |
 *   'lastBlockHeight' |
 *   'startedAt' |
 *   'readyAt' |
 *   'endedAt' |
 *   'chainStartedAt' |
 *   'chainReadyAt' |
 *   'clientStartedAt' |
 *   'clientReadyAt' |
 *   'loadgenStartedAt' |
 *   'loadgenReadyAt' |
 * never } RawStageStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<StageStats,RawStageStatsProps>} */
const rawStageStatsInit = {
  blocksSummaries: null,
  cyclesSummaries: null,
  firstBlockHeight: null,
  lastBlockHeight: {
    writeMulti: true,
  },
  startedAt: null,
  readyAt: null,
  endedAt: null,
  chainStartedAt: null,
  chainReadyAt: null,
  clientStartedAt: null,
  clientReadyAt: null,
  loadgenStartedAt: null,
  loadgenReadyAt: null,
};

/** @param {BlockStats} blockStats */
const blockSummerTransform = ({ blockHeight, liveMode }) => ({
  liveMode: liveMode !== undefined ? Number(liveMode) : undefined,
  startBlockHeight: blockHeight,
  endBlockHeight: blockHeight,
});

/** @param {CycleStats} cycleStats */
const cyclesSummerTransform = ({ success, blockCount, duration }) => ({
  success: Number(success),
  blockCount: blockCount || 0,
  duration: duration || 0,
});

/**
 * @param {BlockStats[] | undefined} blocks
 */
const generateBlocksSummary = (blocks = []) => {
  /** @type {import("./helpers.js").Summer<ReturnType<typeof blockSummerTransform>>} */
  const summer = makeSummer();

  for (const stats of blocks) {
    summer.add(blockSummerTransform(stats));
  }

  return makeBlockStatsSummary(summer.getSums());
};

/**
 * @param {CycleStats[] | undefined} cycles
 */
const generateCyclesSummary = (cycles = []) => {
  /** @type {import("./helpers.js").Summer<ReturnType<typeof cyclesSummerTransform>>} */
  const summer = makeSummer();

  for (const stats of cycles) {
    // Ignore unfinished cycles
    if (stats.success !== undefined) {
      summer.add(cyclesSummerTransform(stats));
    }
  }

  return makeCycleStatsSummary(summer.getSums());
};

/**
 * @param {StageStatsInitData} data
 * @returns {StageStats}
 */
export const makeStageStats = (data) => {
  const { savedData, publicProps, privateSetters } = makeRawStats(
    rawStageStatsInit,
  );

  /** @type {import("./helpers.js").MakeStatsCollectionReturnType<number, BlockStats>} */
  const {
    collection: blocks,
    insert: insertBlock,
    getCount: getBlockCount,
  } = makeStatsCollection();

  /** @type {import("./helpers.js").MakeStatsCollectionReturnType<CycleStatsCollectionKey, CycleStats>} */
  const {
    collection: cycles,
    insert: insertCycle,
    getCount: getCycleCount,
  } = makeStatsCollection();

  /** @type {StageStats['newBlock']} */
  const newBlock = (blockData) => {
    const { blockHeight } = blockData;

    assert(blockHeight);

    if (!getBlockCount()) {
      privateSetters.firstBlockHeight(blockHeight);
    }
    privateSetters.lastBlockHeight(blockHeight);
    // eslint-disable-next-line no-use-before-define
    const block = makeBlockStats(blockData, stats);
    insertBlock(blockHeight, block);
    return block;
  };

  /** @type {StageStats['getOrMakeCycle']} */
  const getOrMakeCycle = (cycleData) => {
    const key = makeCycleStatsKey(cycleData);
    let cycle = cycles[key];
    if (!cycle) {
      // eslint-disable-next-line no-use-before-define
      cycle = makeCycleStats(cycleData, stats);
      insertCycle(key, cycle);
    }
    return cycle;
  };

  const getCyclesSummaries = () => {
    /**
     * @type {import('./helpers.js').MakeStatsCollectionReturnType<
     *    string,
     *    import('./types.js').CycleStatsSummary | undefined
     * >}
     */
    const {
      collection: cyclesSummaries,
      insert: setCyclesSummary,
    } = makeStatsCollection();

    const allCycles = /** @type {CycleStats[]} */ (Object.values(cycles));

    const cyclesByTask = arrayGroupBy(allCycles, ({ task }) => task);

    setCyclesSummary('all', generateCyclesSummary(allCycles));

    for (const [task, taskCycles] of Object.entries(cyclesByTask)) {
      setCyclesSummary(task, generateCyclesSummary(taskCycles));
    }

    return cyclesSummaries;
  };

  const getBlocksSummaries = () => {
    /**
     * @type {import('./helpers.js').MakeStatsCollectionReturnType<
     *    import('./types.js').StageBlocksSummaryType,
     *    import('./types.js').BlockStatsSummary | undefined
     * >}
     */
    const {
      collection: blocksSummaries,
      insert: setBlocksSummary,
    } = makeStatsCollection();

    const allBlocks = /** @type {BlockStats[]} */ (Object.values(blocks));

    const blocksByLiveMode = arrayGroupBy(allBlocks, ({ liveMode }) =>
      String(liveMode),
    );

    setBlocksSummary('all', generateBlocksSummary(allBlocks));
    setBlocksSummary('last100', generateBlocksSummary(allBlocks.slice(-100)));
    setBlocksSummary('onlyLive', generateBlocksSummary(blocksByLiveMode.true));
    setBlocksSummary(
      'onlyCatchup',
      generateBlocksSummary(blocksByLiveMode.false),
    );

    return blocksSummaries;
  };

  /** @type {StageStats['recordEnd']} */
  const recordEnd = (time) => {
    privateSetters.endedAt(time);

    privateSetters.cyclesSummaries(
      getCycleCount() ? getCyclesSummaries() : undefined,
    );
    privateSetters.blocksSummaries(
      getBlockCount() ? getBlocksSummaries() : undefined,
    );
  };

  const getReadyDuration = () =>
    savedData.startedAt &&
    savedData.readyAt &&
    rounder(savedData.readyAt - savedData.startedAt);

  const getDuration = () =>
    savedData.startedAt &&
    savedData.endedAt &&
    rounder(savedData.endedAt - savedData.startedAt);

  const getChainInitDuration = () =>
    savedData.chainStartedAt &&
    savedData.chainReadyAt &&
    rounder(savedData.chainReadyAt - savedData.chainStartedAt);

  const getClientInitDuration = () =>
    savedData.clientStartedAt &&
    savedData.clientReadyAt &&
    rounder(savedData.clientReadyAt - savedData.clientStartedAt);

  const getLoadgenInitDuration = () =>
    savedData.loadgenStartedAt &&
    savedData.loadgenReadyAt &&
    rounder(savedData.loadgenReadyAt - savedData.loadgenStartedAt);

  const stats = harden(
    copyProperties(
      {
        recordStart: privateSetters.startedAt,
        recordReady: privateSetters.readyAt,
        recordEnd,
        recordChainStart: privateSetters.chainStartedAt,
        recordChainReady: privateSetters.chainReadyAt,
        recordClientStart: privateSetters.clientStartedAt,
        recordClientReady: privateSetters.clientReadyAt,
        recordLoadgenStart: privateSetters.loadgenStartedAt,
        recordLoadgenReady: privateSetters.loadgenReadyAt,
        newBlock,
        getOrMakeCycle,
      },
      cloneData(data),
      publicProps,
      makeGetters({
        blocks: () => blocks,
        cycles: () => cycles,
        blockCount: getBlockCount,
        cycleCount: getCycleCount,
        readyDuration: getReadyDuration,
        duration: getDuration,
        chainInitDuration: getChainInitDuration,
        clientInitDuration: getClientInitDuration,
        loadgenInitDuration: getLoadgenInitDuration,
      }),
    ),
  );

  return stats;
};
