import { E } from '@agoric/eventual-send';
import { amountMath } from '@agoric/ERTP';

const pursePetnames = {
  RUN: 'Agoric RUN currency',
  BLD: 'Agoric staking token',
};
const issuerPetnames = {
  RUN: 'RUN',
  BLD: 'BLD',
};

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
        E(agoricNames).lookup('brand', issuerPetnames.BLD),
        E(agoricNames).lookup('instance', 'autoswap'),
        E(wallet).getPurse(pursePetnames.RUN),
        E(wallet).getPurse(pursePetnames.BLD),
      ]);
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
    const payment = harden({ In: bldPurse.withdraw(bldOffered) });
    const seatP = zoe.offer(
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
    const payment = harden({ In: runPurse.withdraw(runOffered) });
    const seatP = zoe.offer(
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
    const runOfferedPerCycle = amountMath.make(runBrand, newRunBalance / BigInt(100));
    const bldOfferedPerCycle = amountMath.make(bldBrand, newBldBalance / BigInt(100));
    tools = { runBrand, bldBrand, runPurse, bldPurse, publicFacet, didInitial: true,
              runOfferedPerCycle, bldOfferedPerCycle };
    await E(scratch).set(KEY, tools);
    console.log(`setup: RUN=${newRunBalance} BLD=${newBldBalance}`);
    console.log(`will trade ${runOfferedPerCycle} RUN and ${bldOfferedPerCycle} BLD per cycle`);
    console.log(`trade-amm: initial trade complete`);
  }
  const { runOfferedPerCycle, bldOfferedPerCycle } = tools;
  console.log('trade-amm: ready for cycles');

  async function tradeAMMCycle() {
    await buyRunWithBld(bldOfferedPerCycle);
    await buyBldWithRun(runOfferedPerCycle);
    const [ newRunBalance, newBldBalance ] = await Promise.all([E(runPurse).getCurrentAmount(),
                                                                E(bldPurse).getCurrentAmount()]);
    console.log(`trade-amm done: RUN=${newRunBalance} BLD=${newBldBalance}`);
  }

  return tradeAMMCycle();
}
