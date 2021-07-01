/* global __dirname */
import path from 'path';
import { E } from '@agoric/eventual-send';

// prepare to make a trade on the AMM each cycle
export async function prepareAMMTrade(homePromise, deployPowers) {
  const key = 'trade-amm';
  const home = await homePromise;
  const { scratch, spawner } = home;
  let agent = await E(scratch).get(key);
  if (!agent) {
    const { bundleSource } = deployPowers;
    const agentFn = path.join(__dirname, 'agent-trade-amm.js');
    const agentBundle = await bundleSource(agentFn);
    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    agent = await E(installerP).spawn([key, home]);
  }

  async function tradeAMMCycle() {
    const [newRunBalance, newBldBalance] = await E(agent).doAMMCycle();
    console.log(
      `trade-amm done: RUN=${newRunBalance.value} BLD=${newBldBalance.value}`,
    );
  }
  console.log(`--- trade-amm ready for cycles`);
  return tradeAMMCycle;
}
