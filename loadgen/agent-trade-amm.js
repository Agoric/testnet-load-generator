import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AmountMath, AssetKind } from '@agoric/ertp';
import { pursePetnames, issuerPetnames } from './petnames';
import { disp } from './display';
import { allValues } from './allValues';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

export default async function startAgent([key, home]) {
  const { zoe, scratch, agoricNames, wallet } = home;

  console.error(`trade-amm: building tools`);
  // const runIssuer = await E(agoricNames).lookup('issuer', issuerPetnames.RUN);
  const { runBrand, bldBrand, autoswap, runPurse, bldPurse } = await allValues({
    runBrand: E(agoricNames).lookup('brand', issuerPetnames.RUN),
    // bldBrand: E(agoricNames).lookup('brand', issuerPetnames.BLD),
    bldBrand: E(E(wallet).getIssuer(issuerPetnames.BLD)).getBrand(),
    autoswap: E(agoricNames).lookup('instance', 'autoswap'),
    runPurse: E(wallet).getPurse(pursePetnames.RUN),
    bldPurse: E(wallet).getPurse(pursePetnames.BLD),
  });
  // const bldBrand = await E(bldPurse).getAllegedBrand();
  const publicFacet = await E(zoe).getPublicFacet(autoswap);

  console.error(`trade-amm: tools installed`);

  async function getBalance(which) {
    let bal;
    if (which === 'RUN') {
      bal = await E(runPurse).getCurrentAmount();
      if (AmountMath.isEmpty(bal)) {
        // some chain setups currently fail to make the purses visible with
        // the right denominations
        throw Error(`no RUN, trade-amm cannot proceed`);
      }
      return bal;
    }
    if (which === 'BLD') {
      bal = await E(bldPurse).getCurrentAmount();
      if (AmountMath.isEmpty(bal)) {
        throw Error(`no BLD, trade-amm cannot proceed`);
      }
      return bal;
    }
    throw Error(`unknown type ${which}`);
  }

  async function getBalances() {
    return allValues({ run: getBalance('RUN'), bld: getBalance('BLD') });
  }

  async function buyRunWithBld(bldOffered) {
    const proposal = harden({
      want: { Out: AmountMath.makeEmpty(runBrand, AssetKind.NAT) },
      give: { In: bldOffered },
    });
    const payment = harden({ In: E(bldPurse).withdraw(bldOffered) });
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
      E(bldPurse).deposit(refundPayout),
      E(runPurse).deposit(payout),
    ]);
  }

  async function buyBldWithRun(runOffered) {
    const proposal = harden({
      want: { Out: AmountMath.makeEmpty(bldBrand, AssetKind.NAT) },
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
      E(bldPurse).deposit(payout),
    ]);
  }

  // perform the setup transfer
  async function doSetupTransfer() {
    let { run, bld } = await getBalances();
    console.error(`trade-amm setup: initial RUN=${disp(run)} BLD=${disp(bld)}`);
    // eslint-disable-next-line no-constant-condition
    if (1) {
      // setup: buy RUN with 50% of our BLD
      console.error(`trade-amm: buying initial RUN with 50% of our BLD`);
      const halfAmount = AmountMath.make(bldBrand, bld.value / BigInt(2));
      await buyRunWithBld(halfAmount);
      ({ run, bld } = await getBalances());
    }
    // we sell 1% of the holdings each time
    const runPerCycle = AmountMath.make(runBrand, run.value / BigInt(100));
    const bldPerCycle = AmountMath.make(bldBrand, bld.value / BigInt(100));
    console.error(`setup: RUN=${disp(run)} BLD=${disp(bld)}`);
    console.error(
      `will trade about ${disp(runPerCycle)} RUN and ${disp(
        bldPerCycle,
      )} BLD per cycle`,
    );
    console.error(`trade-amm: initial trade complete`);
  }
  await doSetupTransfer();

  const agent = Far('AMM agent', {
    async doAMMCycle() {
      console.error('trade-amm cycle: BLD->RUN');
      const bld = await getBalance('BLD');
      const bldOffered = AmountMath.make(bldBrand, bld.value / BigInt(100));
      await buyRunWithBld(bldOffered);

      console.error('trade-amm cycle: RUN->BLD');
      const run = await getBalance('RUN');
      const runOffered = AmountMath.make(runBrand, run.value / BigInt(100));
      await buyBldWithRun(runOffered);

      const [newRunBalance, newBldBalance] = await Promise.all([
        E(runPurse).getCurrentAmount(),
        E(bldPurse).getCurrentAmount(),
      ]);
      console.error('trade-amm cycle: done');
      return [newRunBalance, newBldBalance];
    },
  });

  await E(scratch).set(key, agent);
  console.error('trade-amm: ready for cycles');
  return agent;
}
