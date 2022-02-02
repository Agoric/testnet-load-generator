/* eslint-disable prefer-object-spread */

import {
  makeRawStats,
  cloneData,
  copyProperties,
  rounder as timeRounder,
  percentageRounder,
} from './helpers.js';

/** @typedef {import("./types.js").BlockStatsInitData} BlockStatsInitData */
/** @typedef {import("./types.js").BlockStats} BlockStats */

/**
 * @typedef {|
 *   'liveMode' |
 *   'beginAt' |
 *   'endStartAt' |
 *   'endFinishAt' |
 *   'slogLines' |
 *   'deliveries' |
 *   'firstCrankNum' |
 *   'lastCrankNum' |
 *   'computrons' |
 *   'lag' |
 *   'blockDuration' |
 *   'chainBlockDuration' |
 *   'idleTime' |
 *   'cosmosTime' |
 *   'swingsetTime' |
 *   'processingTime' |
 *   'swingsetPercentage' |
 *   'processingPercentage' |
 * never} RawBlockStatsProps
 */

/** @type {import('./helpers.js').RawStatInit<BlockStats,RawBlockStatsProps>} */
const rawBlockStatsInit = {
  liveMode: null,
  beginAt: null,
  endStartAt: null,
  endFinishAt: null,
  slogLines: {
    default: -Infinity,
    writeMulti: true,
  },
  deliveries: { default: 0, writeMulti: true },
  firstCrankNum: null,
  lastCrankNum: { writeMulti: true },
  computrons: { default: 0, writeMulti: true },
  lag: null,
  blockDuration: null,
  chainBlockDuration: null,
  idleTime: null,
  cosmosTime: null,
  swingsetTime: null,
  processingTime: null,
  swingsetPercentage: null,
  processingPercentage: null,
};

/**
 * @typedef {|
 *   'liveMode' |
 *   'startBlockHeight' |
 *   'endBlockHeight' |
 *   'lag' |
 *   'blockDuration' |
 *   'chainBlockDuration' |
 *   'idleTime' |
 *   'cosmosTime' |
 *   'swingsetTime' |
 *   'processingTime' |
 *   'swingsetPercentage' |
 *   'processingPercentage' |
 *   'deliveries' |
 *   'computrons' |
 * never} BlockStatsSumKeys
 */

/**
 * @param {import('./helpers.js').Summary<BlockStatsSumKeys>} summary
 * @returns {import('./types.js').BlockStatsSummary | undefined}
 */
export const makeBlockStatsSummary = ({
  values,
  weights: blockCount,
  averages,
  totals,
  items,
  mins,
  maxes,
}) =>
  blockCount
    ? {
        blockCount,
        liveMode:
          blockCount === totals.liveMode ||
          (items.liveMode === values && totals.liveMode === 0
            ? false
            : undefined),
        startBlockHeight: mins.startBlockHeight,
        endBlockHeight: maxes.endBlockHeight,
        avgLag: timeRounder(averages.lag),
        avgBlockDuration: timeRounder(averages.blockDuration),
        avgChainBlockDuration: timeRounder(averages.chainBlockDuration),
        avgIdleTime: timeRounder(averages.idleTime),
        avgCosmosTime: timeRounder(averages.cosmosTime),
        avgSwingsetTime: timeRounder(averages.swingsetTime),
        avgProcessingTime: timeRounder(averages.processingTime),
        avgDeliveries: timeRounder(averages.deliveries),
        avgComputrons: timeRounder(averages.computrons),
        avgSwingsetPercentage: percentageRounder(
          averages.swingsetPercentage / 100,
        ),
        avgProcessingPercentage: percentageRounder(
          averages.processingPercentage / 100,
        ),
      }
    : undefined;

/**
 * @param {BlockStatsInitData} data
 * @param {import("./types.js").StageStats} [stageStats]
 * @returns {BlockStats}
 */
export const makeBlockStats = (data, stageStats) => {
  const { publicProps, privateSetters } = makeRawStats(rawBlockStatsInit);

  const prevBlock = stageStats && stageStats.blocks[data.blockHeight - 1];

  privateSetters.chainBlockDuration(
    prevBlock && data.blockTime - prevBlock.blockTime,
  );

  /** @type {BlockStats['recordStart']} */
  const recordStart = (time) => {
    privateSetters.beginAt(time);
    privateSetters.lag(timeRounder(time - data.blockTime));
    const prevBlockEndFinishAt = prevBlock && prevBlock.endFinishAt;
    privateSetters.idleTime(
      prevBlockEndFinishAt && timeRounder(time - prevBlockEndFinishAt),
    );
  };

  /** @type {BlockStats['recordSwingsetStart']} */
  const recordSwingsetStart = (time) => {
    privateSetters.endStartAt(time);
    const { beginAt } = publicProps;
    privateSetters.cosmosTime(beginAt && timeRounder(time - beginAt));
    privateSetters.slogLines(0);
    if (stageStats) {
      privateSetters.liveMode(stageStats.chainReadyAt != null);
    }
  };

  /** @type {BlockStats['recordSlogLine']} */
  const recordSlogLine = () => {
    if (publicProps.endFinishAt === undefined) {
      privateSetters.slogLines(publicProps.slogLines + 1);
    }
  };

  /** @type {BlockStats['recordDelivery']} */
  const recordDelivery = ({ crankNum, computrons }) => {
    privateSetters.deliveries(publicProps.deliveries + 1);
    if (publicProps.firstCrankNum === undefined) {
      privateSetters.firstCrankNum(crankNum);
    }
    const { lastCrankNum } = publicProps;
    if (lastCrankNum === undefined || lastCrankNum < crankNum) {
      privateSetters.lastCrankNum(crankNum);
    }
    if (computrons !== undefined) {
      privateSetters.computrons(publicProps.computrons + computrons);
    }
  };

  /** @type {BlockStats['recordEnd']} */
  const recordEnd = (time) => {
    privateSetters.endFinishAt(time);
    const { beginAt, endStartAt } = publicProps;
    const swingsetTime = endStartAt && time - endStartAt;
    const processingTime = beginAt && time - beginAt;
    const prevBlockEndFinishAt = prevBlock && prevBlock.endFinishAt;
    const blockDuration = prevBlockEndFinishAt && time - prevBlockEndFinishAt;
    privateSetters.swingsetTime(swingsetTime && timeRounder(swingsetTime));
    privateSetters.processingTime(
      processingTime && timeRounder(processingTime),
    );
    privateSetters.blockDuration(blockDuration && timeRounder(blockDuration));
    privateSetters.swingsetPercentage(
      swingsetTime &&
        blockDuration &&
        percentageRounder(swingsetTime / blockDuration),
    );
    privateSetters.processingPercentage(
      processingTime &&
        blockDuration &&
        percentageRounder(processingTime / blockDuration),
    );

    // Finish line itself doesn't count
    privateSetters.slogLines(publicProps.slogLines - 1);
  };

  const stats = harden(
    copyProperties(
      {
        recordStart,
        recordEnd,
        recordSwingsetStart,
        recordSlogLine,
        recordDelivery,
      },
      cloneData(data),
      publicProps,
    ),
  );

  return stats;
};
