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
    //const runIssuer = await E(agoricNames).lookup('issuer', issuerPetnames.RUN);
    const runBrand = await E(agoricNames).lookup('brand', issuerPetnames.RUN);
    const bldBrand = await E(agoricNames).lookup('brand', issuerPetnames.BLD);
    const runPurse = await E(wallet).getPurse(pursePetnames.RUN);
    const bldPurse = await E(wallet).getPurse(pursePetnames.BLD);

    const treasuryInstance = await E(home.agoricNames).lookup('instance', 'Treasury');
    const treasuryPublicFacet = E(zoe).getPublicFacet(treasuryInstance);

    const bldBalance = await E(bldPurse).getCurrentAmount();
    const bldToLock = amountMath.make(bldBrand, bldBalance / BigInt(100));

    // stash everything needed for each cycle under the key on the solo node
    tools = { runBrand, bldBrand, runPurse, bldPurse, treasuryPublicFacet, bldToLock };
    await E(scratch).set(KEY, tools);
    console.log(`create-vault: tools installed`);
  }
  const { runBrand, bldBrand, runPurse, bldPurse, treasuryPublicFacet, bldToLock } = tools;
  console.log('create-vault: ready for cycles');

  async function openVault(bldToLock) {
    const openInvitationP = E(treasuryPublicFacet).makeLoanInvitation();
    const proposal = {
      give: {
        Collateral: bldToLock,
      },
      want: {
        RUN: amountMath.make(runBrand, BigInt(0)),
      },
    };
    const payment = harden({ Collateral: bldPurse.withdraw(bldToLock) });
    const seatP = zoe.offer(openInvitationP, proposal, payment);
    const vaultP = E(seatP).getOfferResult();
    const [ bldPayout, runPayout ] = await Promise.all([E(seatP).getPayout('Collateral'),
                                                        E(seatP).getPayout('RUN')]);
    await Promise.all([E(bldPurse).deposit(bldPayout), E(runPurse).deposit(runPayout)]);
    return vaultP;
  }

  async function closeVault(vault) {
    const runNeeded = await E(vault).getDebtAmount();
    const closeInvitationP = E(vault).makeCloseInvitation();
    const proposal = {
      give: {
        RUN: runNeeded,
      },
      want: {
        Collateral: amountMath.make(bldBrand, BigInt(0)),
      },
    };
    const payment = harden({ RUN: runPurse.withdraw(runNeeded) });
    const seatP = zoe.offer(closeInvitationP, proposal, payment);
    const [ runPayout, bldPayout ] = await Promise.all([E(seatP).getPayout('RUN'),
                                                        E(seatP).getPayout('Collateral')]);
    await Promise.all([E(runPurse).deposit(runPayout), E(bldPurse).deposit(bldPayout)]);
  }

  async function vaultCycle() {
    const vault = await openVault(bldToLock);
    await closeVault(vault);
    const [ newRunBalance, newBldBalance ] = await Promise.all([E(runPurse).getCurrentAmount(),
                                                                E(bldPurse).getCurrentAmount()]);
    console.log(`create-vault done: RUN=${newRunBalance} BLD=${newBldBalance}`);
  }

  return vaultCycle();
}
