/* global console:off */
/* eslint-disable no-continue */

import { warnOnRejection } from '../helpers/async.js';

/**
 * @typedef {{
 *   time: number,
 *   type: 'create-vat',
 *   vatID: string,
 *   name?: string,
 *   dynamic: boolean,
 *   managerType: "local" | "xs-worker" | string,
 * }} SlogCreateVatEvent
 */

/**
 * @typedef {({
 *   time: number,
 *   type: |
 *     'vat-startup-finish' |
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
 *   time: number,
 *   type: SlogCosmicSwingsetBlockEventTypes,
 *   blockHeight?: number,
 *   blockTime: number
 * }} SlogCosmicSwingsetBlockEvent
 */

/**
 * @typedef { |
 *   SlogVatEventTypes |
 *   SlogCosmicSwingsetBlockEventTypes
 * } SlogSupportedEventTypes
 */

/**
 * @typedef { |
 *   SlogVatEvent |
 *   SlogCosmicSwingsetBlockEvent
 * } SlogSupportedEvent
 */

/** @type {SlogVatEventTypes[]} */
const vatSlogEventTypes = [
  'create-vat',
  'vat-startup-finish',
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

/** @param {SlogSupportedEventTypes[]} eventTypes */
const filterSlogEvent = (eventTypes) =>
  new RegExp(`^{"time":\\d+(?:\\.\\d+),"type":"(?:${eventTypes.join('|')})"`);

const slogEventRE = filterSlogEvent([
  ...vatSlogEventTypes,
  ...swingsetRegularBlockSlogEventTypes,
  ...swingsetStartupBlockSlogEventTypes,
]);

/**
 * @param {Pick<import("../tasks/types.js").RunChainInfo, 'slogLines'>} chainInfo
 * @param {Object} param1
 * @param {() => void} param1.resolveFirstEmptyBlock
 * @param {ReturnType<import("./chain-monitor").makeChainMonitor>} [param1.chainMonitor]
 * @param {import("../stats/types.js").LogPerfEvent} param1.logPerfEvent
 * @param {import("../helpers/time.js").TimeSource} [param1.localTimeSource]
 * @param {import("stream").Writable} [param1.slogOutput]
 * @param {Console} param1.console
 */
export const monitorSlog = async (
  { slogLines },
  {
    resolveFirstEmptyBlock,
    chainMonitor,
    localTimeSource,
    logPerfEvent,
    slogOutput,
    console,
  },
) => {
  /** @type {number | null}  */
  let slogStart = null;

  let slogBlocksSeen = 0;
  let slogEmptyBlocksSeen = 0;
  let slogLinesInBlock = 0;

  for await (const line of slogLines) {
    if (slogOutput) {
      slogOutput.write(line);
    }

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

    slogLinesInBlock += 1;

    // Avoid JSON parsing or converting lines we don't care about
    // Parse as ascii, in case the payload has multi-byte chars,
    // the time and type tested prefix is guaranteed to be single-byte.
    if (!slogEventRE.test(line.toString('ascii', 0, 100))) continue;

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
          chainMonitor.updateVat(vatID);
        }
        break;
      }
      case 'cosmic-swingset-bootstrap-block-start': {
        logPerfEvent('chain-first-init-start');
        break;
      }
      case 'cosmic-swingset-bootstrap-block-finish': {
        logPerfEvent('chain-first-init-finish');
        break;
      }
      case 'cosmic-swingset-begin-block': {
        const { blockHeight = 0 } = event;
        if (!slogBlocksSeen) {
          logPerfEvent('stage-first-block', { block: blockHeight });
          if (chainMonitor) {
            await chainMonitor.logProcessUsage().catch((usageErr) => {
              // Abuse first empty block as it will be awaited before monitorChain
              // And won't abruptly end our monitor
              // @ts-ignore resolving with a rejected promise is still "void" ;)
              resolveFirstEmptyBlock(Promise.reject(usageErr));
            });
          }
        }
        console.log('begin-block', blockHeight);
        slogBlocksSeen += 1;
        break;
      }
      case 'cosmic-swingset-end-block-start': {
        if (event.blockHeight === 0) {
          // Before https://github.com/Agoric/agoric-sdk/pull/3491
          // bootstrap didn't have it's own slog entry
          logPerfEvent('chain-first-init-start');
        } else {
          slogLinesInBlock = 0;
        }
        break;
      }
      case 'cosmic-swingset-end-block-finish': {
        if (event.blockHeight === 0) {
          // TODO: measure duration from start to finish
          logPerfEvent('chain-first-init-finish');
        } else {
          const { blockHeight = 0 } = event;
          // Finish line itself doesn't count
          slogLinesInBlock -= 1;
          if (slogLinesInBlock === 0) {
            if (!slogEmptyBlocksSeen) {
              logPerfEvent('stage-first-empty-block', {
                block: blockHeight,
              });
              resolveFirstEmptyBlock();
            }
            slogEmptyBlocksSeen += 1;
          }

          console.log(
            'end-block',
            blockHeight,
            'linesInBlock=',
            slogLinesInBlock,
          );
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
