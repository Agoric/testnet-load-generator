import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AmountMath, AssetKind } from '@agoric/ertp';
import { pursePetnames, issuerPetnames } from './petnames.js';
import { disp } from './display.js';
import { allValues } from './allValues.js';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

export default async function startAgent([key, home, tradeToken]) {
  const { zoe, scratch, agoricNames, wallet, faucet } = home;

  console.error(`trade-amm: building tools`);
  // const runIssuer = await E(agoricNames).lookup('issuer', issuerPetnames.RUN);
  const { runBrand, targetBrand, amm, autoswap, runPurse, targetPurse } =
    await allValues({
      runBrand: E(agoricNames).lookup('brand', issuerPetnames.RUN),
      targetBrand: E(
        E(wallet).getIssuer(issuerPetnames[tradeToken]),
      ).getBrand(),
      amm: E(agoricNames)
        .lookup('instance', 'amm')
        .catch(() => {}),
      autoswap: E(agoricNames)
        .lookup('instance', 'autoswap')
        .catch(() => {}),
      runPurse: E(wallet).getPurse(pursePetnames.RUN),
      targetPurse: E(wallet).getPurse(pursePetnames[tradeToken]),
    });

  {
    const feePurse = await E(faucet)
      .getFeePurse()
      .catch((err) => {
        if (err.name !== 'TypeError') {
          throw err;
        } else {
          return null;
        }
      });

    if (feePurse) {
      const run = await E(runPurse).getCurrentAmount();
      const thirdRunAmount = AmountMath.make(runBrand, run.value / 3n);

      if (AmountMath.isEmpty(run)) {
        throw Error(`no RUN, trade-amm cannot proceed`);
      }

      // TODO: change to the appropriate amounts
      // setup: transfer 33% of our initial RUN to the feePurse
      console.error(
        `trade-amm: depositing ${disp(thirdRunAmount)} into the fee purse`,
      );
      const feePayment = await E(runPurse).withdraw(thirdRunAmount);
      await E(feePurse).deposit(feePayment);
    }
  }

  const publicFacet = await E(zoe).getPublicFacet(amm || autoswap);

  console.error(`trade-amm: tools installed`);

  async function getBalance(which) {
    let bal;
    if (which === 'RUN') {
      bal = await E(runPurse).getCurrentAmount();
      return bal;
    }
    if (which === tradeToken) {
      bal = await E(targetPurse).getCurrentAmount();
      return bal;
    }
    throw Error(`unknown type ${which}`);
  }

  async function getBalances() {
    return allValues({
      run: getBalance('RUN'),
      target: getBalance(tradeToken),
    });
  }

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

  // perform the setup transfer
  async function doSetupTransfer() {
    let { run, target } = await getBalances();
    console.error(
      `trade-amm setup: outstanding RUN=${disp(run)} ${tradeToken}=${disp(
        target,
      )}`,
    );
    // eslint-disable-next-line no-constant-condition
    if (1) {
      // setup: buy trade token with 50% of our remaining RUN (33% of initial amount)
      console.error(
        `trade-amm: buying ${tradeToken} with 50% of our outstanding RUN`,
      );
      const halfAmount = AmountMath.make(runBrand, run.value / BigInt(2));
      await buyTargetWithRun(halfAmount);
      ({ run, target } = await getBalances());
    }
    // we sell 1% of the holdings each time
    const runPerCycle = AmountMath.make(runBrand, run.value / BigInt(100));
    const targetPerCycle = AmountMath.make(
      targetBrand,
      target.value / BigInt(100),
    );
    console.error(`setup: RUN=${disp(run)} ${tradeToken}=${disp(target)}`);
    console.error(
      `will trade about ${disp(runPerCycle)} RUN and ${disp(
        targetPerCycle,
      )} ${tradeToken} per cycle`,
    );
    console.error(`trade-amm: initial trade complete`);
  }
  await doSetupTransfer();

  const agent = Far('AMM agent', {
    async doAMMCycle() {
      console.error(`trade-amm cycle: ${tradeToken}->RUN`);
      const target = await getBalance(tradeToken);
      const targetOffered = AmountMath.make(
        targetBrand,
        target.value / BigInt(100),
      );
      await buyRunWithTarget(targetOffered);

      console.error(`trade-amm cycle: RUN->${tradeToken}`);
      const run = await getBalance('RUN');
      const runOffered = AmountMath.make(runBrand, run.value / BigInt(100));
      await buyTargetWithRun(runOffered);

      const [newRunBalance, newTargetBalance] = await Promise.all([
        E(runPurse).getCurrentAmount(),
        E(targetPurse).getCurrentAmount(),
      ]);
      console.error('trade-amm cycle: done');
      return [newRunBalance, newTargetBalance];
    },
  });

  await E(scratch).set(key, agent);
  console.error('trade-amm: ready for cycles');
  return agent;
}
