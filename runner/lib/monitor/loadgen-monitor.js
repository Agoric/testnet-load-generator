/** @typedef {import('../stats/types.js').StageStats} StageStats */

/**
 * @param {import("../tasks/types.js").RunLoadgenInfo} loadgenInfo
 * @param {Object} param1
 * @param {StageStats} param1.stats
 * @param {object} [param1.notifier]
 * @param {(count: number) => void} [param1.notifier.updateActive]
 * @param {(task: string, seq: number) => void} [param1.notifier.taskFailure]
 * @param {Console} param1.console
 */
export const monitorLoadgen = async (
  { taskEvents },
  { stats, notifier: { updateActive, taskFailure } = {}, console },
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
        updateActive && updateActive(activeCycles.size);
        break;
      }
      case 'finish': {
        const { task, seq, success } = event;
        console.log('finish', event.task, event.seq);
        const cycle = stats.getOrMakeCycle({ task, seq });
        cycle.recordEnd(time, success);
        activeCycles.delete(cycle);
        updateActive && updateActive(activeCycles.size);
        if (!success && taskFailure) {
          taskFailure(task, seq);
        }
        break;
      }
      case 'status':
      default:
    }
  }
};
