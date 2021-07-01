/* global require __dirname */
import path from 'path';
import { E } from '@agoric/eventual-send';

// set up a fungible faucet contract, and a purse to match, if they aren't already present
export async function prepareFaucet(homePromise, deployPowers) {
  const key = 'fungible';
  const home = await homePromise;
  const { scratch, spawner } = home;
  let agent = await E(scratch).get(key);
  if (!agent) {
    const { bundleSource } = deployPowers;
    const faucetFn = require.resolve(`@agoric/zoe/src/contracts/mintPayments`);
    const faucetBundleP = bundleSource(faucetFn);
    const agentFn = path.join(__dirname, 'agent-tap-faucet.js');
    const agentBundleP = bundleSource(agentFn);
    const faucetBundle = await faucetBundleP;
    const agentBundle = await agentBundleP;

    console.log(
      `--- prepareFaucet has bundles ${JSON.stringify(faucetBundle).length} ${
        JSON.stringify(agentBundle).length
      }`,
    );
    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    await installerP;
    console.log(`--- agentBundle installed`);
    agent = await E(installerP).spawn([key, home, faucetBundle]);
  }

  async function faucetCycle() {
    const amount = await E(agent).doFaucetCycle();
    console.log(`new purse balance`, amount.value, new Date());
  }

  console.log(`--- prepareFaucet ready for cycles`);
  return faucetCycle;
}
