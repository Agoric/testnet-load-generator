// @ts-check

/* global __dirname */
import path from 'path';
import { E } from '@agoric/eventual-send';

const key = 'loadgenKit';

/**
 * Create and save the loadgen kit if necessary
 *
 * @param { ERef<Pick<import('./types').Home, UsedHomeCaps>> } home
 * @param { import('./types').DeployPowers } deployPowers
 * @typedef {|
 *   'scratch' |
 *   'spawner' |
 *   'wallet' |
 *   'zoe' |
 * never} UsedHomeCaps
 */
export async function prepareLoadgen(home, deployPowers) {
  const { scratch, spawner, wallet, zoe } = E.get(home);

  /** @type {import('./contract/agent-prepare-loadgen').LoadgenKit | undefined} */
  let loadgenKit = await E(scratch).get(key);
  if (!loadgenKit) {
    const { bundleSource } = deployPowers;
    const mintFn = path.join(__dirname, 'contract', 'mintHolder.js');
    const mintBundle = await bundleSource(mintFn);

    const agentFn = path.join(
      __dirname,
      'contract',
      'agent-prepare-loadgen.js',
    );
    const agentBundle = await bundleSource(agentFn);

    console.log(
      `prepare-loadgen: prepare: mint bundle ${
        JSON.stringify(mintBundle).length
      }, agent bundle ${JSON.stringify(agentBundle).length}`,
    );
    // create a solo-side agent to setup everything
    const installerP = E(spawner).install(agentBundle);
    /** @type {import('./contract/agent-prepare-loadgen').startParam} */
    const agentParam = harden({ wallet, zoe, mintBundle });
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