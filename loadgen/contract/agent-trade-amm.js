// @ts-check

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AmountMath, AssetKind } from '@agoric/ertp';

import { disp } from './display.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/** @param {Purse} purse */
async function getPurseBalance(purse) {
  return /** @type {Promise<Amount<'nat'>>} */ (E(purse).getCurrentAmount());
}

/** @param {Amount<'nat'>} amount */
const onePercent = (amount) =>
  AmountMath.make(amount.brand, amount.value / 100n);

/**
 * This is loaded by the spawner into a new 'spawned' vat on the solo node.
 * The default export function is called with some args.
 *
 * @param {startParam} param
 * @typedef {Awaited<ReturnType<typeof startAgent>>} Agent
 * @typedef { Pick<import('../types').NatAssetKit, 'brand' | 'purse' | 'symbol' | 'displayInfo'>} AssetKit
 * @typedef {{
 *   stableKit: AssetKit,
 *   tokenKit: AssetKit,
 *   amm: ERef<import('../types').AttenuatedAMM>,
 *   zoe: ERef<ZoeService>,
 * }} startParam
 */
export default async function startAgent({
  stableKit: {
    brand: stableBrand,
    purse: stablePurse,
    symbol: stableSymbol,
    displayInfo: { decimalPlaces: stableDecimalPlaces },
  },
  tokenKit: {
    brand: targetBrand,
    purse: targetPurse,
    symbol: targetSymbol,
    displayInfo: { decimalPlaces: targetDecimalPlaces },
  },
  amm: publicFacet,
  zoe,
}) {
  await Promise.all([
    getPurseBalance(stablePurse),
    getPurseBalance(targetPurse),
  ]).then(([stableBalance, targetBalance]) => {
    console.error(
      `trade-amm: will trade about ${disp(
        onePercent(stableBalance),
        stableDecimalPlaces,
      )} ${stableSymbol} and ${disp(
        onePercent(targetBalance),
        targetDecimalPlaces,
      )} ${targetSymbol} per cycle`,
    );
  });

  async function buyStableWithTarget(targetOffered) {
    const proposal = harden({
      want: { Out: AmountMath.makeEmpty(stableBrand, AssetKind.NAT) },
      give: { In: targetOffered },
    });
    const payment = harden({ In: E(targetPurse).withdraw(targetOffered) });
    const seatP = E(zoe).offer(
      E(publicFacet).makeSwapInInvitation(),
      proposal,
      payment,
    );
    const [refundPayout, payout] = await Promise.all([
      E(seatP).getPayout('In'),
      E(seatP).getPayout('Out'),
    ]);
    await Promise.all([
      E(targetPurse).deposit(refundPayout),
      E(stablePurse).deposit(payout),
      E(seatP).getOfferResult(),
    ]);
  }

  async function buyTargetWithStable(stableOffered) {
    const proposal = harden({
      want: { Out: AmountMath.makeEmpty(targetBrand, AssetKind.NAT) },
      give: { In: stableOffered },
    });
    const payment = harden({ In: E(stablePurse).withdraw(stableOffered) });
    const seatP = E(zoe).offer(
      E(publicFacet).makeSwapInInvitation(),
      proposal,
      payment,
    );
    const [refundPayout, payout] = await Promise.all([
      E(seatP).getPayout('In'),
      E(seatP).getPayout('Out'),
    ]);
    await Promise.all([
      E(stablePurse).deposit(refundPayout),
      E(targetPurse).deposit(payout),
      E(seatP).getOfferResult(),
    ]);
  }

  const agent = Far('AMM agent', {
    async doAMMCycle() {
      console.error(`trade-amm: cycle: ${targetSymbol}->${stableSymbol}`);
      const target = await getPurseBalance(targetPurse);
      const targetOffered = onePercent(target);
      await buyStableWithTarget(targetOffered);

      console.error(`trade-amm: cycle: ${stableSymbol}->${targetSymbol}`);
      const stable = await getPurseBalance(stablePurse);
      const stableOffered = onePercent(stable);
      await buyTargetWithStable(stableOffered);

      const [newStableBalance, newTargetBalance] = await Promise.all([
        getPurseBalance(stablePurse),
        getPurseBalance(targetPurse),
      ]);
      console.error('trade-amm: cycle: done');
      return {
        newStableBalanceDisplay: disp(newStableBalance, stableDecimalPlaces),
        newTargetBalanceDisplay: disp(newTargetBalance, targetDecimalPlaces),
        stableSymbol,
        targetSymbol,
      };
    },
  });

  console.error('trade-amm: ready for cycles');
  return agent;
}
