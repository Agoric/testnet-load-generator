import { E } from '@agoric/eventual-send';
import { amountMath } from '@agoric/ertp';
import { pursePetnames, issuerPetnames } from './petnames';

// prepare to make a trade on the AMM each cycle
export async function prepareAMMTrade(homePromise, deployPowers) {
  const KEY = 'trade-amm';
  const home = await homePromise;
  const { zoe, scratch, agoricNames, wallet } = home;
  let tools = await E(scratch).get(KEY);
  if (!tools) {
    console.log(`trade-amm: building tools`);
    //const runIssuer = await E(agoricNames).lookup('issuer', issuerPetnames.RUN);
    const [
      runBrand,
      bldBrand,
      autoswap,
      runPurse,
      bldPurse ] = await Promise.all([
        E(agoricNames).lookup('brand', issuerPetnames.RUN),
        //E(agoricNames).lookup('brand', issuerPetnames.BLD),
        E(E(wallet).getIssuer(issuerPetnames.BLD)).getBrand(),
        E(agoricNames).lookup('instance', 'autoswap'),
        E(wallet).getPurse(pursePetnames.RUN),
        E(wallet).getPurse(pursePetnames.BLD),
      ]);
    //const bldBrand = await E(bldPurse).getAllegedBrand();
    const publicFacet = await E(zoe).getPublicFacet(autoswap);

    // stash everything needed for each cycle under the key on the solo node
    const didInitial = false;
    tools = { runBrand, bldBrand, runPurse, bldPurse, publicFacet, didInitial };
    await E(scratch).set(KEY, tools);
    console.log(`trade-amm: tools installed`);
  }
  const { runBrand, bldBrand, runPurse, bldPurse, publicFacet } = tools;

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
    console.log(`trade-amm: buying initial RUN with 50% of our BLD`);
    // setup: buy RUN with 50% of our BLD
    let bldBalance = await E(bldPurse).getCurrentAmount();
    let halfAmount = amountMath.make(bldBrand, bldBalance.value / BigInt(2));
    await buyRunWithBld(halfAmount);
    const [ newRunBalance, newBldBalance ] = await Promise.all([E(runPurse).getCurrentAmount(),
                                                                E(bldPurse).getCurrentAmount()]);
    const runOfferedPerCycle = amountMath.make(runBrand, newRunBalance.value / BigInt(100));
    const bldOfferedPerCycle = amountMath.make(bldBrand, newBldBalance.value / BigInt(100));
    tools = { runBrand, bldBrand, runPurse, bldPurse, publicFacet, didInitial: true,
              runOfferedPerCycle, bldOfferedPerCycle };
    await E(scratch).set(KEY, tools);
    console.log(`setup: RUN=${newRunBalance.value} BLD=${newBldBalance.value}`);
    console.log(`will trade ${runOfferedPerCycle.value} RUN and ${bldOfferedPerCycle.value} BLD per cycle`);
    console.log(`trade-amm: initial trade complete`);
  }
  const { runOfferedPerCycle, bldOfferedPerCycle } = tools;
  console.log('trade-amm: ready for cycles');

  async function tradeAMMCycle() {
    await buyRunWithBld(bldOfferedPerCycle);
    await buyBldWithRun(runOfferedPerCycle);
    const [ newRunBalance, newBldBalance ] = await Promise.all([E(runPurse).getCurrentAmount(),
                                                                E(bldPurse).getCurrentAmount()]);
    console.log(`trade-amm done: RUN=${newRunBalance.value} BLD=${newBldBalance.value}`);
  }

  return tradeAMMCycle;
}

// this currently takes 7 blocks to complete (at which point we get
// 'trade-amm done' and the new balances), and there are 2 blocks of leftover
// traffic/acks/resolutions happening

