// @ts-check

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AmountMath, AssetKind } from '@agoric/ertp';

import '@agoric/zoe/exported.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/** @param {Purse} purse */
async function getPurseBalance(purse) {
  return /** @type {Promise<Amount<NatValue>>} */ (E(purse).getCurrentAmount());
}

/**
 * This is loaded by the spawner into a new 'spawned' vat on the solo node.
 * The default export function is called with some args.
 *
 * @param {startParam} param
 * @typedef {Awaited<ReturnType<typeof startAgent>>} Agent
 * @typedef { Pick<import('../types').AssetKit, 'brand' | 'purse' | 'name'>} AssetKit
 * @typedef {{
 *   runKit: AssetKit,
 *   tokenKit: AssetKit,
 *   amm: ERef<import('../types').AttenuatedAMM>,
 *   zoe: ERef<ZoeService>,
 * }} startParam
 */
export default async function startAgent({
  runKit: { brand: runBrand, purse: runPurse },
  tokenKit: { brand: targetBrand, purse: targetPurse, name: tradeToken },
  amm: publicFacet,
  zoe,
}) {
  async function buyRunWithTarget(targetOffered) {
    const proposal = harden({
      want: { Out: AmountMath.makeEmpty(runBrand, AssetKind.NAT) },
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
      E(runPurse).deposit(payout),
      E(seatP).getOfferResult(),
    ]);
  }

  async function buyTargetWithRun(runOffered) {
    const proposal = harden({
      want: { Out: AmountMath.makeEmpty(targetBrand, AssetKind.NAT) },
      give: { In: runOffered },
    });
    const payment = harden({ In: E(runPurse).withdraw(runOffered) });
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
      E(runPurse).deposit(refundPayout),
      E(targetPurse).deposit(payout),
      E(seatP).getOfferResult(),
    ]);
  }

  const agent = Far('AMM agent', {
    async doAMMCycle() {
      console.error(`trade-amm: cycle: ${tradeToken}->RUN`);
      const target = await getPurseBalance(targetPurse);
      const targetOffered = AmountMath.make(
        targetBrand,
        target.value / BigInt(100),
      );
      await buyRunWithTarget(targetOffered);

      console.error(`trade-amm: cycle: RUN->${tradeToken}`);
      const run = await getPurseBalance(runPurse);
      const runOffered = AmountMath.make(runBrand, run.value / BigInt(100));
      await buyTargetWithRun(runOffered);

      const [newRunBalance, newTargetBalance] = await Promise.all([
        E(runPurse).getCurrentAmount(),
        E(targetPurse).getCurrentAmount(),
      ]);
      console.error('trade-amm: cycle: done');
      return [newRunBalance, newTargetBalance];
    },
  });

  console.error('trade-amm: ready for cycles');
  return agent;
}
