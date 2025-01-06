/* global setInterval clearInterval console:off */
/* eslint-disable no-continue */

import { basename } from 'path';

import { PromiseAllOrErrors, warnOnRejection } from '../helpers/async.js';

const vatIdentifierRE = /^(v\d+):(.*)$/;

/**
 * @param {object} kernelInfo
 * @param {string | void} kernelInfo.storageLocation
 * @param {import("../helpers/procsfs.js").ProcessInfo} kernelInfo.processInfo
 * @param {object} param1
 * @param {Console} param1.console
 * @param {import('../stats/types.js').LogPerfEvent} param1.logPerfEvent
 * @param {import('../helpers/time.js').TimeSource} param1.cpuTimeSource
 * @param {import('../helpers/fs.js').DirDiskUsage} param1.dirDiskUsage
 */
export const makeChainMonitor = (
  { storageLocation, processInfo: kernelProcessInfo },
  { console, logPerfEvent, cpuTimeSource, dirDiskUsage },
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
    const childrenInfos = new Map(
      await kernelProcessInfo.getChildren().then(
        (infos) =>
          Promise.all(
            infos.map(
              async (info) =>
                /** @type {const} */ ([
                  info,
                  await info.getArgv().catch(() => {}),
                ]),
            ),
          ),
        () => [],
      ),
    );
    for (const [info, vatArgv] of childrenInfos.entries()) {
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
            vatName ? ` "${vatName}"` : ''
          } process before create event`,
          'pid=',
          info.pid,
        );
        // vatInfo = { vatName, processInfo: info };
        // vatInfos.set(vatID, vatInfo);
        continue;
      }

      if (vatInfo.processInfo !== info) {
        const level = vatInfo.started && !vatInfo.processInfo ? 'log' : 'warn';
        const msg = [`found process ${info.pid} for vat ${vatID}`];
        if (vatInfo.vatName) msg.push(`"${vatInfo.vatName}"`);
        if (!vatInfo.started) msg.push('(before vat start event)');
        if (vatInfo.processInfo)
          msg.push(`(replacing process ${vatInfo.processInfo.pid})`);
        console[level](msg.join(' '));
      }

      vatInfo.processInfo = info;
    }
    for (const [vatID, vatInfo] of vatInfos) {
      if (vatInfo.processInfo && !childrenInfos.has(vatInfo.processInfo)) {
        const level = !vatInfo.started ? 'log' : 'warn';
        const msg = [`process ${vatInfo.processInfo.pid} for vat ${vatID}`];
        if (vatInfo.vatName) msg.push(`"${vatInfo.vatName}"`);
        msg.push('exited');
        if (vatInfo.started) msg.push('(before terminate event)');
        console[level](msg.join(' '));

        vatInfo.processInfo = null;
      }

      if (
        vatInfo.started &&
        !vatInfo.local &&
        vatInfo.processInfo === undefined
      ) {
        console.warn(`Vat ${vatID} started but process doesn't exist yet`);
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
          .filter(([, { local, started }]) => !local && started)
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
          real: cpuTimeSource.shift(processInfo.startTimestamp).now(),
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

  const logStorageUsage = storageLocation
    ? async () => {
        logPerfEvent('chain-storage-usage', {
          chain: await dirDiskUsage(storageLocation),
        });
      }
    : async () => {};

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
   * @param {boolean} started
   */
  const updateVat = (vatID, started) => {
    const vatInfo = vatInfos.get(vatID);
    if (!vatInfo) {
      // TODO: warn unknown vat
    } else {
      const wasStarted = vatInfo.started;
      vatInfo.started = started;
      const running = !!vatInfo.processInfo;
      if (wasStarted !== started || running !== started) {
        ensureVatInfoUpdated();
      }
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
