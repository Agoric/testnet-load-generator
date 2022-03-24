// @ts-check

/* global __dirname */
import path from 'path';
import { E } from '@agoric/eventual-send';

import { getLoadgenKit } from './prepare-loadgen.js';

/**
 * set up an agent using the issuerKit prepared by the loadgen
 *
 * @param { ERef<Pick<import('./types').Home, 'scratch' | 'spawner' | 'zoe'>> } home
 * @param { import('./types').DeployPowers } deployPowers
 */
export async function prepareAMMTrade(home, deployPowers) {
  const key = 'trade-amm';
  const { scratch, spawner, zoe } = E.get(home);
  /** @type {ERef<import('./contract/agent-trade-amm').Agent> | undefined} */
  let agent = await E(scratch).get(key);
  if (!agent) {
    const loadgenKit = getLoadgenKit(home);
    const { bundleSource } = deployPowers;

    const agentFn = path.join(__dirname, 'contract', 'agent-trade-amm.js');
    const agentBundle = await bundleSource(agentFn);

    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    const { runKit, ammTokenKit: tokenKit, amm } = await loadgenKit;
    if (runKit && tokenKit && amm) {
      /** @type {import('./contract/agent-trade-amm').startParam} */
      const startParam = { tokenKit, runKit, amm, zoe };
      agent = await E(installerP).spawn(startParam);
      await E(scratch).set(key, agent);
      console.log(`trade-amm: prepare: agent installed`);
    } else {
      console.error(
        `trade-amm: prepare: couldn't install agent, missing prerequisites`,
      );
    }
  }

  async function tradeAMMCycle() {
    if (!agent) {
      throw new Error('No agent available');
    }
    const { newRunBalanceDisplay, newTargetBalanceDisplay, targetToken } =
      await E(agent).doAMMCycle();
    console.log(
      `trade-amm: new purse balances: RUN=${newRunBalanceDisplay} ${targetToken}=${newTargetBalanceDisplay}`,
    );
  }
  console.log(`trade-amm: prepare: ready for cycles`);
  return tradeAMMCycle;
}
