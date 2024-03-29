// @ts-check

import { AmountMath } from '@agoric/ertp';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/far';

import { disp } from './display.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/**
 * This is loaded by the spawner into a new 'spawned' vat on the solo node.
 * The default export function is called with some args.
 *
 * @param {startParam} param
 * @typedef {Awaited<ReturnType<typeof startAgent>>} Agent
 * @typedef {{
 *   tokenKit: import('../types').NatAssetKit,
 * }} startParam
 */
export default async function startAgent({ tokenKit }) {
  const tokenMint = tokenKit.mint;
  assert(tokenMint, assert.details`Faucet task requires a mint`);

  const agent = Far('faucet agent', {
    async doFaucetCycle() {
      console.error(`faucet: cycle start`);
      const payment = await E(tokenMint).mintPayment(
        AmountMath.make(tokenKit.brand, 100_000n),
      );
      await E(tokenKit.purse).deposit(payment);
      console.error(`faucet: cycle done`);
      const amount = await E(tokenKit.purse).getCurrentAmount();
      return {
        amountDisplay: disp(amount, tokenKit.displayInfo.decimalPlaces),
        faucetToken: tokenKit.symbol,
      };
    },
  });

  console.error(`faucet: ready for cycles`);
  return agent;
}
