/* global __dirname */
import path from 'path';
import { E } from '@agoric/eventual-send';
import { disp } from './display';

// Prepare to create and close a vault on each cycle. We measure our
// available BLD at startup. On each cycle, we deposit 1% of that value as
// collateral to borrow as much RUN as they'll give us. Then we pay back the
// loan (using all the borrowed RUN, plus some more as a fee), getting back
// most (but not all?) of our BLD. If we are not interrupted, we finish each
// cycle with slightly less BLD and RUN than we started (because of fees),
// but with no vaults or loans outstanding.

// Make sure to run this after task-trade-amm has started (which converts 50%
// of our BLD into RUN), so we don't TOCTTOU ourselves into believing we have
// twice as much BLD as we really do.

export async function prepareVaultCycle(homePromise, deployPowers) {
  const key = 'open-close-vault';
  const home = await homePromise;
  const { scratch, spawner } = home;
  let agent = await E(scratch).get(key);
  if (!agent) {
    const { bundleSource } = deployPowers;
    const agentFn = path.join(__dirname, 'agent-create-vault.js');
    const agentBundle = await bundleSource(agentFn);
    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    agent = await E(installerP).spawn(key, home);
  }

  async function vaultCycle() {
    const [newRunBalance, newBldBalance] = E(agent).doFaucetCycle();
    console.log(
      `create-vault done: RUN=${disp(newRunBalance)} BLD=${disp(
        newBldBalance,
      )}`,
    );
  }
  return vaultCycle;
}
