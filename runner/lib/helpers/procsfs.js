/* global process */

/**
 * Helper module to read, parse and interpret procfs
 *
 * Authoritative info on content:
 * https://github.com/torvalds/linux/blob/master/Documentation/filesystems/proc.rst
 */

import { performance } from 'perf_hooks';

import { childProcessOutput } from './child-process.js';

const statusLineFormat = /^([^:]+):[\s]+(.+)$/;

/** @typedef {import("./process-info.js").ProcessInfo} ProcessInfo */

/**
 * @callback GetProcessInfo
 * @param {number} pid PID of the process to get info
 * @returns {Promise<ProcessInfo>}
 */

/**
 * @typedef ProcessHelper
 * @property {GetProcessInfo} getProcessInfo
 * @property {() => Promise<number>} getCPUTimeOffset
 */

/**
 *
 * @param {Object} powers
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {number} [powers.startPid] The PID of the process to use as a start time reference
 * @returns {ProcessHelper}
 *
 */
export const makeProcfsHelper = ({ fs, spawn, startPid = process.pid }) => {
  // Kernel data has no encoding so just copy bytes
  /** @type {{encoding: BufferEncoding}} */
  const bufferOptions = { encoding: 'latin1' };

  // A lot of kernel times are in jiffies/ticks, which frequency can be changed
  // through a kernel compilation time configuration
  const userHertzP = (async () => {
    const res = await childProcessOutput(
      spawn('getconf', ['CLK_TCK'], { stdio: 'pipe' }),
    );

    return parseInt(res.toString(bufferOptions.encoding), 10);
  })();

  /** @typedef {string[]} ProcStat */
  /**
   * Returns the split but unparsed stat data from /proc/:pid/stat
   *
   * @param {number} pid
   * @returns {Promise<ProcStat>}
   */
  const getStat = async (pid) => {
    const data = await fs.readFile(`/proc/${pid}/stat`, bufferOptions);
    const idx1 = data.indexOf('(');
    const idx2 = data.lastIndexOf(')');
    return [
      data.substring(0, idx1 - 1),
      data.substring(idx1 + 1, idx2),
      ...data.substring(idx2 + 2).split(' '),
    ];
  };

  /** @typedef {Record<string, string>} ProcStatus */
  /**
   * Returns the split but unparsed status data from /proc/:pid/status
   *
   * @param {number} pid
   * @returns {Promise<ProcStatus>}
   */
  const getStatus = async (pid) => {
    const data = await fs.readFile(`/proc/${pid}/status`, bufferOptions);
    /** @type {ProcStatus} */
    const status = {};
    for (const line of data.split('\n')) {
      const matches = statusLineFormat.exec(line);
      if (matches) {
        status[matches[1]] = matches[2];
      }
    }
    return status;
  };

  /**
   * Returns the split command line from /proc/:pid/cmdline
   *
   * @param {number} pid
   * @returns {Promise<string[] | null>}
   */
  const getCmdline = async (pid) => {
    const data = await fs.readFile(`/proc/${pid}/cmdline`, bufferOptions);
    if (!data) return null;
    const argv = data.split('\x00');
    argv.pop(); // trailing empty line
    return argv;
  };

  /** @param {ProcStat} stat */
  const getStartTicks = (stat) => parseInt(stat[21], 10);

  const startTicksOriginP = getStat(startPid).then(getStartTicks);

  // TODO: Use a WeakValueMap
  /** @type {Map<string, ProcessInfo>} */
  const knownProcessInfo = new Map();

  /** @type {GetProcessInfo} */
  const getProcessInfo = async (pid) => {
    const startTicks = getStartTicks(await getStat(pid));

    // Technically PIDs can be recycled, but the startTicks will be different
    const uniquePid = `${pid}-${startTicks}`;

    /** @param {ProcStat} stat */
    const assertSameProcess = (stat) => {
      assert(String(pid) === stat[0]);
      assert(startTicks === getStartTicks(stat));
    };

    let processInfo = knownProcessInfo.get(uniquePid);

    if (!processInfo) {
      const startTimestamp =
        (startTicks - (await startTicksOriginP)) / (await userHertzP);

      processInfo = harden({
        pid,
        startTimestamp,
        getArgv: async () => {
          return getCmdline(pid);
        },
        getUsageSnapshot: async () => {
          const [stat, status, userHertz] = await Promise.all([
            getStat(pid),
            getStatus(pid),
            userHertzP,
          ]);
          assertSameProcess(stat);

          const times = {
            blockIo: parseInt(stat[41], 10) / userHertz,
            childGuest: parseInt(stat[43], 10) / userHertz,
            childKernel: parseInt(stat[16], 10) / userHertz,
            childUser: parseInt(stat[15], 10) / userHertz,
            guest: parseInt(stat[42], 10) / userHertz,
            kernel: parseInt(stat[14], 10) / userHertz,
            user: parseInt(stat[13], 10) / userHertz,
          };

          // TODO: Parse /proc/:pid/smaps values to get better RSS info
          const memory = {
            // rss: parseInt(stat[23], 10) * 4,
            // rssSoftLimit: parseInt(stat[24], 10),
            // vsize: parseInt(stat[22], 10) / 1024,
            vmData: parseInt(status.VmData, 10),
            vmExe: parseInt(status.VmExe, 10),
            vmHwm: parseInt(status.VmHWM, 10),
            vmLib: parseInt(status.VmLib, 10),
            vmLocked: parseInt(status.VmLck, 10),
            vmPeak: parseInt(status.VmPeak, 10),
            vmPinned: parseInt(status.VmPin, 10),
            vmPte: parseInt(status.VmPTE, 10),
            vmRss: parseInt(status.VmRSS, 10),
            vmSize: parseInt(status.VmSize, 10),
            vmStack: parseInt(status.VmStk, 10),
            vmSwap: parseInt(status.VmSwap, 10),
            rssAnon: parseInt(status.RssAnon, 10),
            rssFile: parseInt(status.RssFile, 10),
            rssShmem: parseInt(status.RssShmem, 10),
          };

          return harden({ times, memory });
        },
        getChildren: async () => {
          assertSameProcess(await getStat(pid));

          const tids = await fs.readdir(`/proc/${pid}/task`, bufferOptions);

          const rawChildrens = await Promise.all(
            tids.map((tid) =>
              fs.readFile(`/proc/${pid}/task/${tid}/children`, bufferOptions),
            ),
          );

          /** @type {Set<number>} */
          const cpids = new Set();

          for (const rawChildren of rawChildrens) {
            const rawCpids = rawChildren.split(' ');
            if (!rawCpids[rawCpids.length - 1]) {
              rawCpids.pop(); // remove empty trail
            }
            for (const rawCpid of rawCpids) {
              cpids.add(parseInt(rawCpid, 10));
            }
          }

          // Ignore any children that may have gone missing by the time we get their info
          const childrenInfoResolutions = await Promise.allSettled(
            [...cpids].map(getProcessInfo),
          );
          return harden(
            childrenInfoResolutions
              .filter(({ status }) => status === 'fulfilled')
              .map(
                (r) =>
                  /** @type {PromiseFulfilledResult<ProcessInfo>} */ (r).value,
              ),
          );
        },
        getParent: async () => {
          const stat = await getStat(pid);
          assertSameProcess(stat);
          const ppid = parseInt(stat[3], 10);
          return getProcessInfo(ppid);
        },
      });
      knownProcessInfo.set(uniquePid, processInfo);
    }

    return processInfo;
  };

  /**
   * Estimates the offset between ProcessInfo startTimestamp
   * and performance.now()'s origin for the current process.
   *
   * The absolute value of this offset should be below 0.01s
   * on a system with somewhat accurate time measurement if
   * node was the first image executed. If there was a delay
   * from process creation to node execution, the value returned
   * will capture an approximation of that delay within 10ms.
   *
   * @returns {Promise<number>} The offset in seconds
   */
  const getCPUTimeOffset = async () => {
    const perfNowBefore = performance.now();
    const uptime = await fs.readFile('/proc/uptime', bufferOptions);
    const perfNow = (perfNowBefore + performance.now()) / 2;

    // Process start time is static and expressed in jiffies
    // It's not adjusted like other kernel monotonic clock
    const startMsOrigin =
      ((await startTicksOriginP) * 1000) / (await userHertzP);

    // Uptime is a monotonic clock that represents elapsed time since system boot
    // It does get adjusted by NTP, and thus might deviate over time from jiffies
    const uptimeMs = Number(uptime.split(' ')[0]) * 1000;

    return Math.round(uptimeMs - startMsOrigin - perfNow) / 1000;
  };

  return harden({ getProcessInfo, getCPUTimeOffset });
};
