// @ts-check

/* global __dirname */
import path from 'path';
import { E } from '@agoric/eventual-send';
import { getLoadgenKit } from './prepare-loadgen.js';

// Prepare to create and close a vault on each cycle. We measure our
// available collateral token at startup. On each cycle, we deposit 1% of that value as
// collateral to borrow as much RUN as they'll give us. Then we pay back the
// loan (using all the borrowed RUN, plus some more as a fee), getting back
// most (but not all?) of our collateral. If we are not interrupted, we finish each
// cycle with slightly less collateral and RUN than we started (because of fees),
// but with no vaults or loans outstanding.

/**
 * set up an agent using the issuerKit and vault prepared by the loadgen
 *
 * @param { ERef<Pick<import('./types').Home, 'scratch' | 'spawner' | 'zoe'>> } home
 * @param { import('./types').DeployPowers } deployPowers
 */
export async function prepareVaultCycle(home, deployPowers) {
  const key = 'open-close-vault';
  const { scratch, spawner, zoe } = E.get(home);
  /** @type {ERef<import('./contract/agent-create-vault').Agent> | undefined} */
  let agent = await E(scratch).get(key);
  if (!agent) {
    const loadgenKit = getLoadgenKit(home);
    const { bundleSource } = deployPowers;

    const agentFn = path.join(__dirname, 'contract', 'agent-create-vault.js');
    const agentBundle = await bundleSource(agentFn);

    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    const {
      runKit,
      vaultTokenKit: tokenKit,
      vaultFactory,
      vaultCollateralManager,
    } = await loadgenKit;
    if (runKit && tokenKit && vaultFactory) {
      /** @type {import('./contract/agent-create-vault').startParam} */
      const startParam = {
        tokenKit,
        runKit,
        vaultFactory,
        vaultCollateralManager,
        zoe,
      };
      agent = await E(installerP).spawn(startParam);
      await E(scratch).set(key, agent);
      console.log(`create-vault: prepare: agent installed`);
    } else {
      console.error(
        `create-vault: prepare: couldn't install agent, missing prerequisites`,
      );
    }
  }

  async function vaultCycle() {
    if (!agent) {
      throw new Error('No agent available');
    }
    const {
      newRunBalanceDisplay,
      newCollateralBalanceDisplay,
      collateralToken,
    } = await E(agent).doVaultCycle();
    console.log(
      `create-vault: new purse balances: RUN=${newRunBalanceDisplay} ${collateralToken}=${newCollateralBalanceDisplay}`,
    );
  }

  console.log(`create-vault: prepare: ready for cycles`);
  return vaultCycle;
}
