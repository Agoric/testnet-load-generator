/* global console:off */
/* eslint-disable no-continue */

import { warnOnRejection } from '../helpers/async.js';

/** @typedef {import('../stats/types.js').StageStats} StageStats */
/** @typedef {import('../stats/types.js').BlockStats} BlockStats */
/** @typedef {import('../helpers/time.js').TimeValueS} TimeValueS */

/**
 * @typedef {{
 *   time: TimeValueS,
 *   monotime?: number,
 *   type: 'create-vat',
 *   vatID: string,
 *   name?: string,
 *   dynamic: boolean,
 *   managerType: "local" | "xs-worker" | string,
 * }} SlogCreateVatEvent
 */

/**
 * @typedef {({
 *   time: TimeValueS,
 *   monotime?: number,
 *   type: |
 *     'vat-startup-finish' |
 *     'terminate' |
 *     'replay-transcript-start' | // Renamed to 'start-replay'
 *     'start-replay',
 *   vatID: string
 * }) | SlogCreateVatEvent} SlogVatEvent
 */

/** @typedef {SlogVatEvent["type"]} SlogVatEventTypes */

/**
 * @typedef { |
 *   'cosmic-swingset-bootstrap-block-start' |
 *   'cosmic-swingset-bootstrap-block-finish' |
 *   'cosmic-swingset-end-block-start' |
 *   'cosmic-swingset-end-block-finish' |
 *   'cosmic-swingset-begin-block'
 * } SlogCosmicSwingsetBlockEventTypes
 */

/**
 * @typedef {{
 *   time: TimeValueS,
 *   monotime?: number,
 *   type: SlogCosmicSwingsetBlockEventTypes,
 *   blockHeight?: number,
 *   blockTime: TimeValueS
 * }} SlogCosmicSwingsetBlockEvent
 */

/**
 * @typedef {{
 *   time: TimeValueS,
 *   monotime?: number,
 *   type: 'deliver',
 *   crankNum: number,
 *   vatID: string,
 *   deliveryNum: number,
 * }} SlogCosmicSwingsetVatDeliveryEvent
 */

/**
 * @typedef {{
 *   time: TimeValueS,
 *   monotime?: number,
 *   type: 'deliver-result',
 *   crankNum: number,
 *   vatID: string,
 *   deliveryNum: number,
 *   dr: [
 *    tag: 'ok' | 'error',
 *    message: null | string,
 *    usage: { compute: number } | null
 *   ],
 * }} SlogCosmicSwingsetVatDeliveryResultEvent
 */

/**
 * @typedef { |
 *   SlogCosmicSwingsetVatDeliveryEvent |
 *   SlogCosmicSwingsetVatDeliveryResultEvent
 * } SlogCosmicSwingsetVatEvent
 */

/** @typedef {SlogCosmicSwingsetVatEvent["type"]} SlogCosmicSwingsetVatEventTypes */

/**
 * @typedef { |
 *   SlogVatEventTypes |
 *   SlogCosmicSwingsetVatEventTypes |
 *   SlogCosmicSwingsetBlockEventTypes
 * } SlogSupportedEventTypes
 */

/**
 * @typedef { |
 *   SlogVatEvent |
 *   SlogCosmicSwingsetVatEvent |
 *   SlogCosmicSwingsetBlockEvent
 * } SlogSupportedEvent
 */

/** @type {SlogVatEventTypes[]} */
const vatSlogEventTypes = [
  'create-vat',
  'vat-startup-finish',
  'terminate',
  'replay-transcript-start',
  'start-replay',
];

/** @type {SlogCosmicSwingsetBlockEventTypes[]} */
const swingsetRegularBlockSlogEventTypes = [
  'cosmic-swingset-begin-block',
  'cosmic-swingset-end-block-start',
  'cosmic-swingset-end-block-finish',
];

/** @type {SlogCosmicSwingsetBlockEventTypes[]} */
const swingsetStartupBlockSlogEventTypes = [
  'cosmic-swingset-bootstrap-block-start',
  'cosmic-swingset-bootstrap-block-finish',
];

/** @type {SlogCosmicSwingsetVatEventTypes[]} */
const swingsetActiveSlogEventTypes = ['deliver', 'deliver-result'];

/** @param {SlogSupportedEventTypes[]} eventTypes */
const filterSlogEvent = (eventTypes) =>
  new RegExp(
    `^{(?:"time":\\d+(?:\\.\\d+),)?"type":"(?:${eventTypes.join('|')})"`,
  );

const startEventRE = filterSlogEvent([
  ...vatSlogEventTypes,
  ...swingsetRegularBlockSlogEventTypes,
  ...swingsetStartupBlockSlogEventTypes,
]);
const activeEventRE = filterSlogEvent([
  ...vatSlogEventTypes,
  ...swingsetRegularBlockSlogEventTypes,
  ...swingsetActiveSlogEventTypes,
]);

/**
 * @param {Pick<import("../tasks/types.js").RunKernelInfo, 'slogLines'>} chainInfo
 * @param {object} param1
 * @param {StageStats} param1.stats
 * @param {{blockDone(block: BlockStats): void}} [param1.notifier]
 * @param {ReturnType<import("./chain-monitor").makeChainMonitor>} [param1.chainMonitor]
 * @param {import("../stats/types.js").LogPerfEvent} param1.logPerfEvent
 * @param {import("../helpers/time.js").TimeSource} [param1.localTimeSource]
 * @param {Console} param1.console
 */
export const monitorSlog = async (
  { slogLines },
  { stats, notifier, chainMonitor, localTimeSource, logPerfEvent, console },
) => {
  /** @type {number | null}  */
  let slogStart = null;

  /** @type {BlockStats | null} */
  let block = null;

  let eventRE = startEventRE;

  for await (const line of slogLines) {
    if (slogStart == null && chainMonitor) {
      // TODO: figure out a better way
      // There is a risk we could be late to the party here, with the chain
      // having started some time before us but in reality we usually find
      // the process before it starts the kernel
      slogStart = localTimeSource ? localTimeSource.now() : 0;
      warnOnRejection(
        chainMonitor.logStorageUsage(),
        console,
        'Failed to get first storage usage',
      );
    }

    if (block) {
      block.recordSlogLine();
    }

    // Avoid JSON parsing or converting lines we don't care about
    // Parse as ascii, in case the payload has multi-byte chars,
    // the time and type tested prefix is guaranteed to be single-byte.
    if (!eventRE.test(line.toString('ascii', 0, 100))) continue;

    const localEventTime = localTimeSource && localTimeSource.getTime();

    /** @type {SlogSupportedEvent} */
    let event;
    try {
      event = JSON.parse(line.toString('utf8'));
    } catch (error) {
      console.warn('Failed to parse slog line', line, error);
      continue;
    }

    const delay = localEventTime
      ? Math.round((localEventTime - event.time) * 1000)
      : 0;

    if (delay > 100) {
      console.log('slog event', event.type, 'delay', delay, 'ms');
    }

    switch (event.type) {
      case 'create-vat': {
        if (chainMonitor) {
          const { vatID, name: vatName, managerType } = event;
          chainMonitor.createVat(vatID, vatName, managerType);
        }
        break;
      }
      case 'vat-startup-finish':
      case 'replay-transcript-start':
      case 'start-replay': {
        if (chainMonitor) {
          const { vatID } = event;
          chainMonitor.updateVat(vatID, true);
        }
        break;
      }
      case 'terminate': {
        if (chainMonitor) {
          const { vatID } = event;
          chainMonitor.updateVat(vatID, false);
        }
        break;
      }
      case 'cosmic-swingset-bootstrap-block-start': {
        logPerfEvent('chain-first-init-start');
        break;
      }
      case 'cosmic-swingset-bootstrap-block-finish': {
        logPerfEvent('chain-first-init-finish');
        eventRE = activeEventRE;
        break;
      }
      case 'cosmic-swingset-begin-block': {
        const { time, blockHeight = 0, blockTime } = event;
        if (!stats.blockCount) {
          logPerfEvent('stage-first-block', { block: blockHeight });
          if (chainMonitor) {
            // This will abruptly end the monitor if there is an error
            await chainMonitor.logProcessUsage();
          }
          // On restart, the first active slog event is a begin block
          eventRE = activeEventRE;
        }
        console.log('begin-block', blockHeight);
        block = stats.newBlock({ blockHeight, blockTime });
        block.recordStart(time);
        break;
      }
      case 'cosmic-swingset-end-block-start': {
        if (!block) {
          // Before https://github.com/Agoric/agoric-sdk/pull/3491
          // bootstrap didn't have it's own slog entry
          // However in that case there is no begin-block
          logPerfEvent('chain-first-init-start');
        } else {
          const { time, blockHeight = 0 } = event;
          assert(block.blockHeight === blockHeight);
          block.recordSwingsetStart(time);
        }
        break;
      }
      case 'cosmic-swingset-end-block-finish': {
        if (!block) {
          // TODO: measure duration from start to finish
          logPerfEvent('chain-first-init-finish');
          eventRE = activeEventRE;
        } else {
          const { time, blockHeight = 0 } = event;

          assert(block.blockHeight === blockHeight);
          block.recordEnd(time);
          notifier && notifier.blockDone(block);

          console.log(
            'end-block',
            blockHeight,
            'linesInBlock=',
            block.slogLines,
          );
          block = null;
        }
        break;
      }
      case 'deliver': {
        break;
      }
      case 'deliver-result': {
        if (block) {
          let computrons;
          const {
            crankNum,
            deliveryNum,
            vatID,
            dr: [, , usage],
          } = event;
          if (usage && typeof usage === 'object' && 'compute' in usage) {
            computrons = usage.compute;
          }
          block.recordDelivery({ crankNum, deliveryNum, vatID, computrons });
        }
        break;
      }
      default: {
        console.warn(
          'Parsed an unexpected slog event:',
          // @ts-expect-error
          event.type,
        );
      }
    }
  }
};
