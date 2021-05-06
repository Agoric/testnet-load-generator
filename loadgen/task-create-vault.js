import { E } from '@agoric/eventual-send';
import { amountMath } from '@agoric/ertp';
//import { allComparable } from '@agoric/same-structure';
import { pursePetnames, issuerPetnames } from './petnames';
import { multiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport';
import { disp } from './display';
import { allValues } from './allValues';

// Prepare to create and close a vault on each cycle. We measure our
// available BLD at startup. On each cycle, we deposit 1% of that value as
// collateral to borrow as much RUN as they'll give us. Then we pay back the
// loan (using all the borrowed RUN, plus some more as a fee), getting back
// most (but not all?) of our BLD. If we are not interrupted, we finish each
// cycle with slightly less BLD and RUN than we started (because of fees),
// but with no vaults or loans outstanding.

// Make sure to run this after task-trade-amm has started (which converts 50%
// of our BLD into RUN), so we don't TOCTTOU ourselves into believing we have
// twice as much BLD as we really do.

export async function prepareVaultCycle(homePromise, deployPowers) {
  const KEY = 'open-close-vault';
  const home = await homePromise;
  const { zoe, scratch, agoricNames, wallet } = home;
  let tools = await E(scratch).get(KEY);
  if (!tools) {
    console.log(`create-vault: building tools`);
    const { runBrand, bldBrand, runPurse, bldPurse, treasuryInstance } = await allValues({
      runBrand: E(agoricNames).lookup('brand', issuerPetnames.RUN),
      // bldBrand: E(agoricNames).lookup('brand', issuerPetnames.BLD),
      bldBrand: E(E(wallet).getIssuer(issuerPetnames.BLD)).getBrand(),
      runPurse: E(wallet).getPurse(pursePetnames.RUN),
      bldPurse: E(wallet).getPurse(pursePetnames.BLD),
      treasuryInstance: E(home.agoricNames).lookup('instance', 'Treasury'),
    });

    const treasuryPublicFacet = E(zoe).getPublicFacet(treasuryInstance);

    const bldBalance = await E(bldPurse).getCurrentAmount();
    if (bldBalance.value === BigInt(0)) {
      throw Error(`create-vault: getCurrentAmount(BLD) broken (says 0)`);
    }
    console.log(`create-vault: initial balance: ${disp(bldBalance)} BLD`);
    const bldToLock = amountMath.make(bldBrand, bldBalance.value / BigInt(100));

    const collaterals = await E(treasuryPublicFacet).getCollaterals();
    const cdata = collaterals.find(c => c.brand === bldBrand);
    const priceRate = cdata.marketPrice;
    const half = makeRatio(BigInt(50), runBrand);
    const wantedRun = multiplyBy(multiplyBy(bldToLock, priceRate), half);

    // stash everything needed for each cycle under the key on the solo node
    tools = { runBrand, bldBrand, runPurse, bldPurse, treasuryPublicFacet, bldToLock, wantedRun };
    await E(scratch).set(KEY, tools);
    console.log(`create-vault: tools installed`);
  }
  const { runBrand, bldBrand, runPurse, bldPurse, treasuryPublicFacet, bldToLock, wantedRun } = tools;
  console.log('create-vault: ready for cycles');
  console.log(`create-vault: bldToLock=${disp(bldToLock)}, wantedRun=${disp(wantedRun)}`);

  async function openVault(bldToLock) {
    const openInvitationP = E(treasuryPublicFacet).makeLoanInvitation();
    const proposal = harden({
      give: {
        Collateral: bldToLock,
      },
      want: {
        RUN: wantedRun,
      },
    });
    const payment = harden({ Collateral: E(bldPurse).withdraw(bldToLock) });
    const seatP = E(zoe).offer(openInvitationP, proposal, payment);
    await seatP;
    const [ bldPayout, runPayout ] = await Promise.all([E(seatP).getPayout('Collateral'),
                                                        E(seatP).getPayout('RUN')]);
    await Promise.all([E(bldPurse).deposit(bldPayout), E(runPurse).deposit(runPayout)]);
    const offerResult = await E(seatP).getOfferResult();
    console.log(`create-vault: vault opened`);
    return offerResult.vault;
  }

  async function closeVault(vault) {
    const runNeeded = await E(vault).getDebtAmount();
    const closeInvitationP = E(vault).makeCloseInvitation();
    const proposal = {
      give: {
        RUN: runNeeded,
      },
      want: {
        Collateral: amountMath.makeEmpty(bldBrand),
      },
    };
    const payment = harden({ RUN: E(runPurse).withdraw(runNeeded) });
    const seatP = E(zoe).offer(closeInvitationP, proposal, payment);
    const [ runPayout, bldPayout ] = await Promise.all([E(seatP).getPayout('RUN'),
                                                        E(seatP).getPayout('Collateral')]);
    await Promise.all([E(runPurse).deposit(runPayout), E(bldPurse).deposit(bldPayout)]);
    console.log(`create-vault: vault closed`);
  }

  async function vaultCycle() {
    const vault = await openVault(bldToLock);
    await closeVault(vault);
    const [ newRunBalance, newBldBalance ] = await Promise.all([E(runPurse).getCurrentAmount(),
                                                                E(bldPurse).getCurrentAmount()]);
    console.log(`create-vault done: RUN=${disp(newRunBalance)} BLD=${disp(newBldBalance)}`);
  }

  return vaultCycle;
}
