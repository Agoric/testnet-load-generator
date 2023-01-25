// @ts-check

import { E } from '@agoric/eventual-send';

import { pathResolveShim } from './powers-shim.js';
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
    const { bundleSource, pathResolve = pathResolveShim } = deployPowers;

    const agentFn = pathResolve('contract', 'agent-trade-amm.js');
    const agentBundle = await bundleSource(agentFn);

    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    const { stableKit, ammTokenKit: tokenKit, amm } = await loadgenKit;
    if (stableKit && tokenKit && amm) {
      /** @type {import('./contract/agent-trade-amm').startParam} */
      const startParam = { tokenKit, stableKit, amm, zoe };
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
    const {
      newStableBalanceDisplay,
      newTargetBalanceDisplay,
      stableSymbol,
      targetSymbol,
    } = await E(agent).doAMMCycle();
    console.log(
      `trade-amm: new purse balances: ${stableSymbol}=${newStableBalanceDisplay} ${targetSymbol}=${newTargetBalanceDisplay}`,
    );
  }
  console.log(`trade-amm: prepare: ready for cycles`);
  return tradeAMMCycle;
}
