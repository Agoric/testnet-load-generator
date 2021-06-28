import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { amountMath } from '@agoric/ertp';
// import { allComparable } from '@agoric/same-structure';
import { multiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport';
import { pursePetnames, issuerPetnames } from './petnames';
import { disp } from './display';
import { allValues } from './allValues';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

export default async function startAgent([key, home]) {
  const { zoe, scratch, agoricNames, wallet } = home;

  console.log(`create-vault: building tools`);
  const {
    runBrand,
    bldBrand,
    runPurse,
    bldPurse,
    treasuryInstance,
  } = await allValues({
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

  console.log(`create-vault: tools installed`);

  console.log(
    `create-vault: bldToLock=${disp(bldToLock)}, wantedRun=${disp(wantedRun)}`,
  );

  async function openVault() {
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
    const [bldPayout, runPayout] = await Promise.all([
      E(seatP).getPayout('Collateral'),
      E(seatP).getPayout('RUN'),
    ]);
    await Promise.all([
      E(bldPurse).deposit(bldPayout),
      E(runPurse).deposit(runPayout),
    ]);
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
    const [runPayout, bldPayout] = await Promise.all([
      E(seatP).getPayout('RUN'),
      E(seatP).getPayout('Collateral'),
    ]);
    await Promise.all([
      E(runPurse).deposit(runPayout),
      E(bldPurse).deposit(bldPayout),
    ]);
    console.log(`create-vault: vault closed`);
  }

  const agent = Far('vault agent', {
    async vaultCycle() {
      const vault = await openVault(bldToLock);
      await closeVault(vault);
      const [newRunBalance, newBldBalance] = await Promise.all([
        E(runPurse).getCurrentAmount(),
        E(bldPurse).getCurrentAmount(),
      ]);
      return [newRunBalance, newBldBalance];
    },
  });

  await E(scratch).set(key, agent);
  console.log('create-vault: ready for cycles');
  return agent;
}
