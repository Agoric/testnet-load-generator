import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AmountMath } from '@agoric/ertp';
// import { allComparable } from '@agoric/same-structure';
import {
  multiplyBy,
  makeRatio,
} from '@agoric/zoe/src/contractSupport/index.js';
import { pursePetnames, issuerPetnames } from './petnames.js';
import { disp } from './display.js';
import { allValues } from './allValues.js';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

export default async function startAgent([key, home]) {
  const { zoe, scratch, agoricNames, wallet } = home;

  console.error(`create-vault: building tools`);
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
  if (AmountMath.isEmpty(bldBalance)) {
    throw Error(`create-vault: getCurrentAmount(BLD) broken (says 0)`);
  }
  console.error(`create-vault: initial balance: ${disp(bldBalance)} BLD`);
  // put 1% into the vault
  const bldToLock = AmountMath.make(bldBrand, bldBalance.value / BigInt(100));

  // we only withdraw half the value of the collateral, giving us 200%
  // collateralization
  const collaterals = await E(treasuryPublicFacet).getCollaterals();
  const cdata = collaterals.find((c) => c.brand === bldBrand);
  const priceRate = cdata.marketPrice;
  const half = makeRatio(BigInt(50), runBrand);
  const wantedRun = multiplyBy(multiplyBy(bldToLock, priceRate), half);

  console.error(`create-vault: tools installed`);

  console.error(
    `create-vault: bldToLock=${disp(bldToLock)}, wantedRun=${disp(wantedRun)}`,
  );

  // we fix the 1% 'bldToLock' value at startup, and use it for all cycles
  // (we close over 'bldToLock')
  async function openVault() {
    console.error('create-vault: openVault');
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
    console.error(`create-vault: vault opened`);
    return offerResult.vault;
  }

  async function closeVault(vault) {
    console.error('create-vault: closeVault');
    const runNeeded = await E(vault).getDebtAmount();
    const closeInvitationP = E(vault).makeCloseInvitation();
    const proposal = {
      give: {
        RUN: runNeeded,
      },
      want: {
        Collateral: AmountMath.makeEmpty(bldBrand),
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
      E(seatP).getOfferResult(),
    ]);
    console.error(`create-vault: vault closed`);
  }

  const agent = Far('vault agent', {
    async doVaultCycle() {
      const vault = await openVault(bldToLock);
      await closeVault(vault);
      const [newRunBalance, newBldBalance] = await Promise.all([
        E(runPurse).getCurrentAmount(),
        E(bldPurse).getCurrentAmount(),
      ]);
      console.error('create-vault: cycle done');
      return [newRunBalance, newBldBalance];
    },
  });

  await E(scratch).set(key, agent);
  console.error('create-vault: ready for cycles');
  return agent;
}
