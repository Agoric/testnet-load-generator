/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeStatsCollection,
  cloneData,
  makeGetters,
  copyProperties,
  rounder,
} from './helpers.js';
import { makeBlockStats } from './blocks.js';
import { makeCycleStats, makeCycleStatsKey } from './cycles.js';

/** @typedef {import("./types.js").BlockStats} BlockStats */
/** @typedef {import("./types.js").CycleStats} CycleStats */
/** @typedef {import("./types.js").CycleStatsCollectionKey} CycleStatsCollectionKey */
/** @typedef {import("./types.js").StageStatsInitData} StageStatsInitData */
/** @typedef {import("./types.js").StageStats} StageStats */

/**
 * @typedef {|
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
    const block = makeBlockStats(blockData);
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
        recordEnd: privateSetters.endedAt,
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
