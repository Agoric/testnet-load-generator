import { E } from '@agoric/eventual-send';
import { amountMath } from '@agoric/ertp';
import { pursePetnames, issuerPetnames } from './petnames';
import { disp } from './display';
import { allValues } from './allValues';

// prepare to make a trade on the AMM each cycle
export async function prepareAMMTrade(homePromise, deployPowers) {
  const KEY = 'trade-amm';
  const home = await homePromise;
  const { zoe, scratch, agoricNames, wallet } = home;
  let tools = await E(scratch).get(KEY);
  if (!tools) {
    console.log(`trade-amm: building tools`);
    //const runIssuer = await E(agoricNames).lookup('issuer', issuerPetnames.RUN);
    const {
      runBrand,
      bldBrand,
      autoswap,
      runPurse,
      bldPurse } = await allValues({
        runBrand: E(agoricNames).lookup('brand', issuerPetnames.RUN),
        //bldBrand: E(agoricNames).lookup('brand', issuerPetnames.BLD),
        bldBrand: E(E(wallet).getIssuer(issuerPetnames.BLD)).getBrand(),
        autoswap: E(agoricNames).lookup('instance', 'autoswap'),
        runPurse: E(wallet).getPurse(pursePetnames.RUN),
        bldPurse: E(wallet).getPurse(pursePetnames.BLD),
      });
    //const bldBrand = await E(bldPurse).getAllegedBrand();
    const publicFacet = await E(zoe).getPublicFacet(autoswap);

    // stash everything needed for each cycle under the key on the solo node
    tools = { runBrand, bldBrand, runPurse, bldPurse, publicFacet, didInitial: false };
    await E(scratch).set(KEY, tools);
    console.log(`trade-amm: tools installed`);
  }
  const { runBrand, bldBrand, runPurse, bldPurse, publicFacet } = tools;

  async function getBalance(which) {
    let bal;
    if (which === 'RUN') {
      bal = await E(runPurse).getCurrentAmount();
      if (bal.value === BigInt(0)) {
        // some chain setups currently fail to make the purses visible with
        // the right denominations
        throw Error(`no RUN, trade-amm cannot proceed`);
      }
      return bal;
    }
    if (which === 'BLD') {
      bal = await E(bldPurse).getCurrentAmount();
      if (bal.value === BigInt(0)) {
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
      want: { Out: amountMath.make(runBrand, BigInt(0)) },
      give: { In: bldOffered },
    });
    const payment = harden({ In: E(bldPurse).withdraw(bldOffered) });
    const seatP = E(zoe).offer(
      E(publicFacet).makeSwapInInvitation(),
      proposal,
      payment,
    );
    const [ refundPayout, payout ] = await Promise.all([E(seatP).getPayout('In'),
                                                        E(seatP).getPayout('Out')]);
    await Promise.all([E(bldPurse).deposit(refundPayout),
                       E(runPurse).deposit(payout)]);
  }

  async function buyBldWithRun(runOffered) {
    const proposal = harden({
      want: { Out: amountMath.make(bldBrand, BigInt(0)) },
      give: { In: runOffered },
    });
    const payment = harden({ In: E(runPurse).withdraw(runOffered) });
    const seatP = E(zoe).offer(
      E(publicFacet).makeSwapInInvitation(),
      proposal,
      payment,
    );
    const [ refundPayout, payout ] = await Promise.all([E(seatP).getPayout('In'),
                                                        E(seatP).getPayout('Out')]);
    await Promise.all([E(runPurse).deposit(refundPayout),
                       E(bldPurse).deposit(payout)]);
  }
  
  // have we performed the setup transfer yet?
  if (!tools.didInitial) {
    let { run, bld } = await getBalances();
    console.log(`trade-amm setup: initial RUN=${disp(run)} BLD=${disp(bld)}`);
    if (1) {
      // setup: buy RUN with 50% of our BLD
      console.log(`trade-amm: buying initial RUN with 50% of our BLD`);
      let halfAmount = amountMath.make(bldBrand, bld.value / BigInt(2));
      await buyRunWithBld(halfAmount);
      ({ run, bld } = await getBalances());
    }
    const runPerCycle = amountMath.make(runBrand, run.value / BigInt(100));
    const bldPerCycle = amountMath.make(bldBrand, bld.value / BigInt(100));
    tools = { ...tools, didInitial: true };
    await E(scratch).set(KEY, tools);
    console.log(`setup: RUN=${disp(run)} BLD=${disp(bld)}`);
    console.log(`will trade about ${disp(runPerCycle)} RUN and ${disp(bldPerCycle)} BLD per cycle`);
    console.log(`trade-amm: initial trade complete`);
  }
  const { runOfferedPerCycle, bldOfferedPerCycle } = tools;
  console.log('trade-amm: ready for cycles');

  async function tradeAMMCycle() {
    const bld = await getBalance('BLD');
    const bldOffered = amountMath.make(bldBrand, bld.value / BigInt(100));
    await buyRunWithBld(bldOffered);

    const run = await getBalance('RUN');
    const runOffered = amountMath.make(runBrand, run.value / BigInt(100));
    await buyBldWithRun(runOffered);

    const [ newRunBalance, newBldBalance ] = await Promise.all([E(runPurse).getCurrentAmount(),
                                                                E(bldPurse).getCurrentAmount()]);
    console.log(`trade-amm done: RUN=${newRunBalance.value} BLD=${newBldBalance.value}`);
  }

  return tradeAMMCycle;
}
