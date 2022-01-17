/* global process */

import { childProcessOutput } from '../helpers/child-process.js';
import { asJSON } from '../helpers/stream.js';

/**
 *
 * @param {Object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @returns {import("./types.js").OrchestratorTasks['getEnvInfo']}
 *
 */
export const makeGetEnvInfo = ({ spawn }) => {
  return harden(async ({ stderr }) => {
    const chainEnv = Object.create(process.env);
    // Disable any lockdown options as that interferes with stdout
    chainEnv.LOCKDOWN_OPTIONS = undefined;

    const versionCp = spawn(
      'ag-chain-cosmos',
      ['version', '--long', '--output', 'json'],
      {
        stdio: ['ignore', 'pipe', stderr],
        env: chainEnv,
      },
    );
    const version = await childProcessOutput(versionCp, asJSON);

    return { agChainCosmosVersion: version };
  });
};
