import { E } from '@agoric/eventual-send';
import { makeIssuerKit, amountMath } from '@agoric/ertp';
import { pursePetnames, issuerPetnames } from './petnames';
import { disp } from './display';
import { allValues } from './allValues';

// prepare to make trades on the simple exchange each cycle
export async function prepareSimpleExchange(homePromise, deployPowers) {
  const KEY = 'trade-simple-exchange';
  const home = await homePromise;
  const { zoe, scratch, agoricNames, wallet } = home;
  let tools = await E(scratch).get(KEY);
  if (!tools) {
    const {
      runIssuer,
      bldIssuer,
      runPurse,
      bldPurse } = await allValues({
        runIssuer: E(agoricNames).lookup('issuer', issuerPetnames.RUN),
        bldIssuer: E(agoricNames).lookup('issuer', issuerPetnames.BLD),
        runPurse: E(wallet).getPurse(pursePetnames.RUN),
        bldPurse: E(wallet).getPurse(pursePetnames.BLD),
      });
    const runBrand = runIssuer.brand;
    const bldBrand = bldIssuer.brand;
    
    const runBalance = await E(runPurse).getCurrentAmount();
    if (runBalance.value < BigInt(1000000)) {
      throw Error(`insufficient RUN, trade-simple-exchange cannot proceed`);
    }
    const bldBalance = await E(bldPurse).getCurrentAmount();
    if (bldBalance.value < BigInt(1000000)) {
      throw Error(`insufficient BLD, trade-simple-exchange cannot proceed`);
    }

    const { bundleSource } = deployPowers;
    const bundle = await bundleSource(
      require.resolve(`@agoric/zoe/src/contracts/simpleExchange`),
    );
    const installation = await E(zoe).install(bundle);
    const publicFacet = await E(zoe).startInstance(
      installation, {
        Asset: runIssuer,
        Price: bldIssuer,
      }
    );

    tools = { runBrand, bldBrand, runPurse, bldPurse };
    await E(scratch).set(KEY, tools);
    console.log(`trade-simple-exchange: tools installed`);
  }
  const { runBrand, bldBrand, runPurse, bldPurse } = tools;

  function randomPositiveInt(max) {
    return Math.floor(Math.random * (max - 1)) + 1;
  }

  async function tradeSimpleExchangeCycle() {
    const numIterations = 10;

    for (let i = 0; i < numIterations; i++) {
      let invitation = E(publicFacet).makeInvitation();
      let option = randomPositiveInt(2);
      let giveAmount = randomPositiveInt(5) / 1000;
      let wantAmount = randomPositiveInt(5) / 1000;
      let proposal, payment;
      
      if (option == 1) {
        proposal = harden({
          give: { Asset: amountMath.make(runBrand, giveAmount) },
          want: { Price: amountMath.make(bldBrand, wantAmount) },
          exit: { onDemand: null },
        });
        payment = { Asset: amountMath.make(runBrand, giveAmount) };
      } else {
        proposal = harden({
          give: { Asset: amountMath.make(bldBrand, wantAmount) },
          want: { Price: amountMath.make(runBrand, giveAmount) },
          exit: { onDemand: null },
        });
        payment = { Asset: amountMath.make(bldBrand, wantAmount) };
      }
      let seat = await E(zoe).offer(invitation, proposal, payment);
    }

    console.log(`trade-simple-exchange done: ${numIterations} iterations`);
  }

  return tradeSimpleExchangeCycle;
}
