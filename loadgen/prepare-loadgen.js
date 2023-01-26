// @ts-check

import { E } from '@agoric/eventual-send';

import { pathResolveShim, makeInstall } from './powers-shim.js';
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
 * @param { Partial<Record<string, string>>} env
 */
export async function prepareLoadgen(home, deployPowers, env) {
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
    const { bundleSource, pathResolve = pathResolveShim } = deployPowers;
    const mustPublish =
      env.MUST_USE_PUBLISH_BUNDLE === '1' ||
      env.MUST_USE_PUBLISH_BUNDLE === 'true';
    const install = await makeInstall(home, deployPowers, { mustPublish });
    const mintFn = pathResolve('contract', 'mintHolder.js');
    const { installation: mintInstallation } = E.get(
      install(mintFn, 'loadgen-mint'),
    );

    const agentFn = pathResolve('contract', 'agent-prepare-loadgen.js');
    const agentBundle = await bundleSource(agentFn);

    console.log(
      `prepare-loadgen: prepare: agent bundle ${
        JSON.stringify(agentBundle).length
      }`,
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
      mintInstallation,
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
