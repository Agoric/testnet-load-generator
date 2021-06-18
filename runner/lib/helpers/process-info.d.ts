/**
 * See https://github.com/torvalds/linux/blob/master/Documentation/filesystems/proc.rst
 * for details on some of these values
 */

/** Process times in seconds (converted from jiffies) */
export type ProcessTimes = {
  /** time spent waiting for block IO */
  blockIo: number;
  /** guest time of the task children */
  childGuest: number;
  /** kernel mode including children */
  childKernel: number;
  /** user mode including children */
  childUser: number;
  /** guest time of the task */
  guest: number;
  /** kernel mode */
  kernel: number;
  /** user mode */
  user: number;
};

/** Process memory sizes in kiB */
export type ProcessMemory = {
  /** peak virtual memory size */
  vmPeak: number;
  /** total program size */
  vmSize: number;
  /** locked memory size */
  vmLocked: number;
  /** pinned memory size */
  vmPinned: number;
  /** peak resident set size ("high water mark") */
  vmHwm: number;
  /** size of memory portions. It contains the three following parts (vmRSS = rssAnon + rssFile + rssShmem) */
  vmRss: number;
  /** size of resident anonymous memory */
  rssAnon: number;
  /** size of resident file mappings */
  rssFile: number;
  /** size of resident shmem memory (includes SysV shm, mapping of tmpfs and shared anonymous mappings) */
  rssShmem: number;
  /** size of private data segments */
  vmData: number;
  /** size of stack segments */
  vmStack: number;
  /** size of text segment */
  vmExe: number;
  /** size of shared library code */
  vmLib: number;
  /** size of page table entries */
  vmPte: number;
  /** amount of swap used by anonymous private data (shmem swap usage is not included) */
  vmSwap: number;
};

export interface ProcessInfo {
  /** The PID of the process */
  readonly pid: number;
  /** The process' static start time in seconds relative to the origin process start */
  readonly startTimestamp: number;
  /** Retrieves the current command line. This may change if when process "exec" */
  getArgv(): Promise<string[] | null>;
  /** Retrieves the current timing and memory usage for the process */
  getUsageSnapshot(): Promise<{ times: ProcessTimes; memory: ProcessMemory }>;
  /** Retrieves the current list of child processes */
  getChildren(): Promise<ProcessInfo[]>;
  /**
   * Retrieves the parent of the process.
   * This may change if the original parent terminates.
   */
  getParent(): Promise<ProcessInfo>;
}
