// @ts-check

import { E } from '@agoric/eventual-send';

import { pathResolveShim } from './powers-shim.js';
import { getLoadgenKit } from './prepare-loadgen.js';

/**
 * set up a fungible faucet purse and agent using the issuerKit prepared by the loadgen
 *
 * @param { ERef<Pick<import('./types').Home, 'scratch' | 'spawner'>> } home
 * @param { import('./types').DeployPowers } deployPowers
 */
export async function prepareFaucet(home, deployPowers) {
  const key = 'fungible';
  const { scratch, spawner } = E.get(home);
  /** @type {ERef<import('./contract/agent-tap-faucet.js').Agent>} */
  let agent = await E(scratch).get(key);
  if (!agent) {
    const loadgenKit = getLoadgenKit(home);
    const { bundleSource, pathResolve = pathResolveShim } = deployPowers;

    const agentFn = pathResolve('contract', 'agent-tap-faucet.js');
    const agentBundle = await bundleSource(agentFn);

    console.log(
      `faucet: prepare: agent bundle ${JSON.stringify(agentBundle).length}`,
    );
    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    const { tokenKit } = await loadgenKit;
    /** @type {import('./contract/agent-tap-faucet').startParam} */
    const startParam = { tokenKit };
    agent = await E(installerP).spawn(startParam);
    await E(scratch).set(key, agent);
    console.log(`faucet: prepare: agent installed`);
  }

  async function faucetCycle() {
    const { amountDisplay, faucetToken } = await E(agent).doFaucetCycle();
    console.log(`faucet: new purse balance: ${faucetToken}=${amountDisplay}`);
  }

  console.log(`faucet: prepare: ready for cycles`);
  return faucetCycle;
}
