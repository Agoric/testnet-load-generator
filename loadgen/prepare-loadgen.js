// @ts-check

import { E } from '@agoric/eventual-send';

import { pathResolveShim } from './powers-shim.js';
import { fallbackCollateralToken, fallbackTradeToken } from './config.js';

const key = 'loadgenKit';

/**
 * Create and save the loadgen kit if necessary
 *
 * @param { ERef<Pick<import('./types').Home, UsedHomeCaps>> } home
 * @param { import('./types').DeployPowers } deployPowers
 * @typedef {|
 *   'agoricNames' |
 *   'faucet' |
 *   'priceAuthorityAdminFacet' |
 *   'scratch' |
 *   'spawner' |
 *   'vaultFactoryCreatorFacet' |
 *   'wallet' |
 *   'zoe' |
 * never} UsedHomeCaps
 */
export async function prepareLoadgen(home, deployPowers) {
  const {
    agoricNames,
    faucet,
    priceAuthorityAdminFacet,
    scratch,
    spawner,
    vaultFactoryCreatorFacet,
    wallet,
    zoe,
  } = E.get(home);

  /** @type {import('./contract/agent-prepare-loadgen').LoadgenKit | undefined} */
  let loadgenKit = await E(scratch).get(key);
  if (!loadgenKit) {
    const {
      bundleSource,
      publishBundle,
      pathResolve = pathResolveShim,
    } = deployPowers;
    const mintFn = pathResolve('contract', 'mintHolder.js');
    const mintBundle = E.when(bundleSource(mintFn), publishBundle);

    const agentFn = pathResolve('contract', 'agent-prepare-loadgen.js');
    const agentBundle = await bundleSource(agentFn);

    console.log(
      `prepare-loadgen: prepare: agent bundle ${
        JSON.stringify(agentBundle).length
      }`,
    );
    E.when(mintBundle, (bundle) =>
      console.log(
        `prepare-loadgen: prepare: mint bundle ${
          JSON.stringify(bundle).length
        }`,
      ),
    );
    // create a solo-side agent to setup everything
    const installerP = E(spawner).install(agentBundle);
    /** @type {import('./contract/agent-prepare-loadgen').startParam} */
    const agentParam = harden({
      agoricNames,
      faucet,
      priceAuthorityAdminFacet,
      vaultFactoryCreatorFacet,
      wallet,
      zoe,
      mintBundle,
      fallbackCollateralToken,
      fallbackTradeToken,
    });
    loadgenKit = await E(installerP).spawn(agentParam);

    await E(scratch).set(key, loadgenKit);

    console.error(`prepare-loadgen: prepare: loadgen kit ready`);
  }
}

/**
 * Get the loadgen kit
 *
 * @param { ERef<Pick<import('./types').Home, 'scratch'>> } home
 */
export async function getLoadgenKit(home) {
  const { scratch } = E.get(home);

  /** @type {import('./contract/agent-prepare-loadgen').LoadgenKit | undefined} */
  const loadgenKit = await E(scratch).get(key);
  if (!loadgenKit) {
    throw new Error('Not initialized');
  }
  return loadgenKit;
}
