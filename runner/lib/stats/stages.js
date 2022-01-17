/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeStatsCollection,
  cloneData,
  makeGetters,
  copyProperties,
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
 * never } RawStageStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<StageStats,RawStageStatsProps>} */
const rawStageStatsInit = {
  firstBlockHeight: null,
  lastBlockHeight: {
    writeMulti: true,
  },
};

/**
 * @param {StageStatsInitData} data
 * @returns {StageStats}
 */
export const makeStageStats = (data) => {
  const { publicProps, privateSetters } = makeRawStats(rawStageStatsInit);

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
  const stats = harden(
    copyProperties(
      {
        recordStart: () => {},
        recordEnd: () => {},
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
      }),
    ),
  );

  return stats;
};
