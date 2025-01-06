/* global process */

import {
  childProcessOutput,
  makePrinterSpawn,
} from '../helpers/child-process.js';
import { getConsoleAndStdio } from './helpers.js';

/**
 *
 * @param {object} powers
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {import("./types.js").SDKBinaries} powers.sdkBinaries
 * @returns {import("./types.js").OrchestratorTasks['getEnvInfo']}
 */
export const makeGetEnvInfo = ({ spawn, sdkBinaries }) => {
  return harden(async ({ stdout, stderr }) => {
    const { console, stdio } = getConsoleAndStdio('env-info', stdout, stderr);
    const printerSpawn = makePrinterSpawn({
      spawn,
      print: (cmd) => console.log(cmd),
    });

    const chainEnv = Object.create(process.env);
    // Disable any lockdown options as that interferes with stdout
    chainEnv.LOCKDOWN_OPTIONS = undefined;

    const versionCp = printerSpawn(
      sdkBinaries.cosmosChain,
      ['version', '--long', '--output', 'json'],
      {
        stdio: ['ignore', 'pipe', stdio[2]],
        env: chainEnv,
      },
    );
    const out = await childProcessOutput(versionCp);

    const json = out.toString('utf-8').replace(/^Removing .+$/m, '');
    try {
      const version = JSON.parse(json);
      return { agChainCosmosVersion: version };
    } catch (err) {
      stdio[1].write(out);
      throw err;
    }
  });
};
