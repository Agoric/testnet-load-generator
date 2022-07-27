/** @typedef {import('../stats/types.js').StageStats} StageStats */

/**
 * @typedef {object} TaskNotifier
 * @property {(task: string, seq: number) => void} start
 * @property {(task: string, seq: number, success: boolean) => void} finish
 */

/**
 * @param {import("../tasks/types.js").RunLoadgenInfo} loadgenInfo
 * @param {object} param1
 * @param {StageStats} param1.stats
 * @param {TaskNotifier} [param1.notifier]
 * @param {Console} param1.console
 */
export const monitorLoadgen = async (
  { taskEvents },
  { stats, notifier, console },
) => {
  /** @type {Set<import('../stats/types.js').CycleStats>} */
  const activeCycles = new Set();

  for await (const event of taskEvents) {
    const { time } = event;
    switch (event.type) {
      case 'start': {
        const { task, seq } = event;
        console.log('start', task, seq);
        const cycle = stats.getOrMakeCycle({ task, seq });
        if (!activeCycles.has(cycle)) {
          cycle.recordStart(time);
          activeCycles.add(cycle);
          notifier?.start?.(task, seq);
        }
        break;
      }
      case 'finish': {
        const { task, seq, success } = event;
        console.log('finish', event.task, event.seq);
        const cycle = stats.getOrMakeCycle({ task, seq });
        if (activeCycles.delete(cycle)) {
          cycle.recordEnd(time, success);
          notifier?.finish?.(task, seq, success);
        }
        break;
      }
      case 'status':
      default:
    }
  }
};
