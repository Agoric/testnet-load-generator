/* global setInterval clearInterval console:off */
/* eslint-disable no-continue */

import { basename } from 'path';
import { performance } from 'perf_hooks';

import { PromiseAllOrErrors, warnOnRejection } from '../helpers/async.js';

const vatIdentifierRE = /^(v\d+):(.*)$/;

/**
 * @param {Pick<import("../tasks/types.js").RunChainInfo, 'storageLocation' | 'processInfo'>} chainInfo
 * @param {Object} param1
 * @param {Console} param1.console
 * @param {import('../stats/types.js').LogPerfEvent} param1.logPerfEvent
 * @param {number} param1.cpuTimeOffset
 * @param {import('../helpers/fs.js').DirDiskUsage} param1.dirDiskUsage
 */
export const makeChainMonitor = (
  { storageLocation, processInfo: kernelProcessInfo },
  { console, logPerfEvent, cpuTimeOffset, dirDiskUsage },
) => {
  /**
   * @typedef {{
   *    processInfo: import("../helpers/procsfs.js").ProcessInfo | null | undefined,
   *    vatName: string | undefined,
   *    local: boolean,
   *    started: boolean,
   *  }} VatInfo
   */
  /** @type {Map<string, VatInfo>} */
  const vatInfos = new Map();
  let vatUpdated = Promise.resolve();

  const updateVatInfos = async () => {
    console.log('Updating vat infos');
    const childrenInfos = new Set(
      await kernelProcessInfo.getChildren().catch(() => []),
    );
    for (const info of childrenInfos) {
      const vatArgv = await info.getArgv(); // eslint-disable-line no-await-in-loop
      if (!vatArgv || basename(vatArgv[0]).slice(0, 2) !== 'xs') continue;
      const vatIdentifierMatches = vatIdentifierRE.exec(vatArgv[1]);
      if (!vatIdentifierMatches) continue;
      const vatID = vatIdentifierMatches[1];
      const vatInfo = vatInfos.get(vatID);

      if (!vatInfo) {
        /** @type {string | undefined} */
        let vatName = vatIdentifierMatches[2];
        if (!vatName || vatName === 'undefined') vatName = undefined;
        // TODO: warn found vat process without create event
        console.warn(
          `found vat ${vatID}${
            vatName ? ` ${vatName}` : ''
          } process before create event`,
          'pid=',
          info.pid,
        );
        // vatInfo = { vatName, processInfo: info };
        // vatInfos.set(vatID, vatInfo);
        continue;
      }

      if (vatInfo.processInfo !== info) {
        // TODO: warn if replacing with new processInfo ?
      }

      vatInfo.processInfo = info;

      // if (!vatInfo.started) {
      //   monitorConsole.warn(
      //     `found vat ${vatID}${
      //       vatInfo.vatName ? ` ${vatInfo.vatName}` : ''
      //     } process before vat start event`,
      //     'pid=',
      //     info.pid,
      //   );
      // }
    }
    for (const [vatID, vatInfo] of vatInfos) {
      if (vatInfo.processInfo && !childrenInfos.has(vatInfo.processInfo)) {
        vatInfo.processInfo = null;
      }

      if (vatInfo.started && !vatInfo.local && !vatInfo.processInfo) {
        // Either the vat started but the process doesn't exist yet (undefined)
        // or the vat process exited but the vat didn't stop yet (null)
        console.warn(
          `Vat ${vatID} started but process ${
            vatInfo.processInfo === null ? 'exited early' : "doesn't exist yet"
          }`,
        );
      }
    }
  };

  const ensureVatInfoUpdated = async () => {
    const vatUpdatedBefore = vatUpdated;
    await vatUpdated;
    if (vatUpdated === vatUpdatedBefore) {
      vatUpdated = updateVatInfos();
      warnOnRejection(
        vatUpdated,
        console,
        'Failed to update vat process infos',
      );
      await vatUpdated;
    }
  };

  const logProcessUsage = async () => {
    await vatUpdated;
    const results = await PromiseAllOrErrors(
      [
        {
          eventData: {
            processType: 'kernel',
          },
          processInfo: kernelProcessInfo,
        },
        ...[...vatInfos]
          .filter(([, { local }]) => !local)
          .map(([vatID, { processInfo, vatName }]) => ({
            eventData: {
              processType: 'vat',
              vatID,
              name: vatName,
            },
            processInfo,
          })),
      ].map(async ({ eventData, processInfo }) => {
        if (!processInfo) {
          console.warn('missing process', eventData);
          return false;
        }
        const { times, memory } = await processInfo.getUsageSnapshot();
        logPerfEvent('chain-process-usage', {
          ...eventData,
          real:
            Math.round(
              performance.now() * 1000 -
                (processInfo.startTimestamp - cpuTimeOffset) * 1e6,
            ) / 1e6,
          ...times,
          ...memory,
        });
        return true;
      }),
    );
    if (results.some((result) => result === false)) {
      throw new Error('Missing vat processes.');
    }
    return results;
  };

  const logStorageUsage = async () => {
    logPerfEvent('chain-storage-usage', {
      chain: await dirDiskUsage(storageLocation),
    });
  };

  /** @type {NodeJS.Timer | null} */
  let monitorIntervalId = null;

  const stop = () => {
    if (monitorIntervalId) {
      clearInterval(monitorIntervalId);
      monitorIntervalId = null;
    }
  };

  /** @param {number} interval */
  const start = (interval) => {
    stop();
    monitorIntervalId = setInterval(
      () =>
        warnOnRejection(
          PromiseAllOrErrors([logStorageUsage(), logProcessUsage()]),
          console,
          'Failure during usage monitoring',
        ),
      interval,
    );
  };

  /**
   *
   * @param {string} vatID
   * @param {string | undefined} vatName
   * @param {string} vatType
   */
  const createVat = (vatID, vatName, vatType) => {
    if (!vatInfos.has(vatID)) {
      vatInfos.set(vatID, {
        vatName,
        processInfo: undefined,
        local: vatType === 'local',
        started: false,
      });
    } else {
      // TODO: warn already created vat before
    }
  };

  /**
   *
   * @param {string} vatID
   */
  const updateVat = (vatID) => {
    const vatInfo = vatInfos.get(vatID);
    if (!vatInfo) {
      // TODO: warn unknown vat
    } else if (!vatInfo.processInfo) {
      ensureVatInfoUpdated();
    }
  };

  return harden({
    start,
    stop,
    logProcessUsage,
    logStorageUsage,
    createVat,
    updateVat,
  });
};
