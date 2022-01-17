/** @typedef {import('../stats/types.js').StageStats} StageStats */

/**
 * @param {import("../tasks/types.js").RunLoadgenInfo} loadgenInfo
 * @param {Object} param1
 * @param {StageStats} param1.stats
 * @param {{updateActive(count: number): void}} [param1.notifier]
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
        cycle.recordStart(time);
        activeCycles.add(cycle);
        notifier && notifier.updateActive(activeCycles.size);
        break;
      }
      case 'finish': {
        const { task, seq, success } = event;
        console.log('finish', event.task, event.seq);
        const cycle = stats.getOrMakeCycle({ task, seq });
        cycle.recordEnd(time, success);
        activeCycles.delete(cycle);
        notifier && notifier.updateActive(activeCycles.size);
        break;
      }
      case 'status':
      default:
    }
  }
};
