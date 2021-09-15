/* global require __dirname */
// @ts-check
import path from 'path';
import { E } from '@agoric/eventual-send';

import '@agoric/zoe/exported.js';

/**
 * @template T
 * @typedef { import('@agoric/eventual-send').ERef<T> } ERef<T>
 */

/**
 * @typedef {{ moduleFormat: unknown }} Bundle
 */
/**
 *
 * @param {ERef<Home>} homePromise
 * @param {{ bundleSource: typeof import('@agoric/bundle-source').default }} deployPowers
 *
 * @typedef { ReturnType<import('@agoric/spawner').makeSpawner> } Spawner
 * @typedef {{
 *   chainTimerService: ERef<Timer>,
 *   scratch: ERef<Store>,
 *   spawner: ERef<Spawner>,
 *   zoe: ERef<ZoeService>,
 *   faucet: Faucet,
 *   wallet: UserWallet,
 *  }} Home
 * @typedef {{ get: (key: unknown) => any, set: (k: unknown, v: unknown) => void }} Store
 * @typedef { * } UserWallet TODO: see @agoric/dapp-svelte-wallet-api
 * @typedef { * } Faucet TODO: ???
 */
export async function preparePoll(homePromise, deployPowers) {
  const key = 'poll-meeting-time-742';
  const home = await homePromise;
  const { scratch, spawner } = home;
  /** @type { ReturnType<import('./agent-collect-votes.js').default>} */
  let agent = await E(scratch).get(key);
  if (!agent) {
    const { bundleSource } = deployPowers;
    const [registrarBundle, counterBundle, agentBundle] = await Promise.all([
      bundleSource(
        require.resolve(`@agoric/governance/src/committeeRegistrar.js`),
      ),
      bundleSource(require.resolve(`@agoric/governance/src/binaryVoteCounter`)),
      bundleSource(path.join(__dirname, 'agent-collect-votes.js')),
    ]);

    console.log(
      `--- collectVotes has bundles ${JSON.stringify(registrarBundle).length} ${
        JSON.stringify(agentBundle).length
      } ${JSON.stringify(counterBundle).length}`,
    );
    // create the solo-side agent to drive each cycle, let it handle zoe
    const installerP = E(spawner).install(agentBundle);
    await installerP;
    console.log(`--- agentBundle installed`);
    agent = await E(installerP).spawn([
      key,
      home,
      registrarBundle,
      counterBundle,
    ]);
  }

  async function collectVotes() {
    console.error('collectVotes');
    const status = await E(agent).doCollectVotes();
    console.log(`new status`, status, new Date());
  }

  console.log(`--- collectVotes ready for cycles`);
  return collectVotes;
}
