/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  makeStatsCollection,
  cloneData,
  makeGetters,
  copyProperties,
} from './helpers.js';
import { makeBlockStats } from './blocks.js';

/** @typedef {import("./types.js").BlockStats} BlockStats */
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

  const stats = harden(
    copyProperties(
      {
        recordStart: () => {},
        recordEnd: () => {},
        newBlock,
      },
      cloneData(data),
      publicProps,
      makeGetters({
        blocks: () => blocks,
        blockCount: getBlockCount,
      }),
    ),
  );

  return stats;
};
