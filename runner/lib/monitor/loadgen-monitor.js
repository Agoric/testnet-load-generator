/** @typedef {import('../stats/types.js').StageStats} StageStats */

/**
 * @param {import("../tasks/types.js").RunLoadgenInfo} loadgenInfo
 * @param {Object} param1
 * @param {StageStats} param1.stats
 * @param {Console} param1.console
 */
export const monitorLoadgen = async ({ taskEvents }, { stats, console }) => {
  for await (const event of taskEvents) {
    switch (event.type) {
      case 'start': {
        const { task, seq } = event;
        console.log('start', task, seq);
        const cycle = stats.getOrMakeCycle({ task, seq });
        cycle.recordStart();
        break;
      }
      case 'finish': {
        const { task, seq, success } = event;
        console.log('finish', event.task, event.seq);
        const cycle = stats.getOrMakeCycle({ task, seq });
        cycle.recordEnd(success);
        break;
      }
      case 'status':
      default:
    }
  }
};
