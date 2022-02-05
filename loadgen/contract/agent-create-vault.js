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

export default async function startAgent([key, home, collateralToken]) {
  const { zoe, scratch, agoricNames, wallet } = home;

  console.error(`create-vault: building tools`);
  const {
    runBrand,
    collateralBrand,
    runPurse,
    collateralPurse,
    treasuryInstance,
    vaultFactoryInstance,
  } = await allValues({
    runBrand: E(agoricNames).lookup('brand', issuerPetnames.RUN),
    collateralBrand: E(
      E(wallet).getIssuer(issuerPetnames[collateralToken]),
    ).getBrand(),
    runPurse: E(wallet).getPurse(pursePetnames.RUN),
    collateralPurse: E(wallet).getPurse(pursePetnames[collateralToken]),
    treasuryInstance: E(agoricNames)
      .lookup('instance', 'Treasury')
      .catch(() => {}),
    vaultFactoryInstance: E(agoricNames)
      .lookup('instance', 'VaultFactory')
      .catch(() => {}),
  });

  const treasuryPublicFacet = E(zoe).getPublicFacet(
    vaultFactoryInstance || treasuryInstance,
  );

  const collateralBalance = await E(collateralPurse).getCurrentAmount();
  if (AmountMath.isEmpty(collateralBalance)) {
    throw Error(
      `create-vault: getCurrentAmount(${collateralToken}) broken (says 0)`,
    );
  }
  console.error(
    `create-vault: initial balance: ${disp(
      collateralBalance,
    )} ${collateralToken}`,
  );
  // put 1% into the vault
  const collateralToLock = AmountMath.make(
    collateralBrand,
    collateralBalance.value / BigInt(100),
  );

  // we only withdraw half the value of the collateral, giving us 200%
  // collateralization
  const collaterals = await E(treasuryPublicFacet).getCollaterals();
  const cdata = collaterals.find((c) => c.brand === collateralBrand);
  const priceRate = cdata.marketPrice;
  const half = makeRatio(BigInt(50), runBrand);
  const wantedRun = multiplyBy(multiplyBy(collateralToLock, priceRate), half);

  console.error(`create-vault: tools installed`);

  console.error(
    `create-vault: collateralToLock=${disp(
      collateralToLock,
    )} ${collateralToken}, wantedRun=${disp(wantedRun)}`,
  );

  // we fix the 1% 'collateralToLock' value at startup, and use it for all cycles
  // (we close over 'collateralToLock')
  async function openVault() {
    console.error('create-vault: openVault');
    const openInvitationP = E(treasuryPublicFacet).makeLoanInvitation();
    const proposal = harden({
      give: {
        Collateral: collateralToLock,
      },
      want: {
        RUN: wantedRun,
      },
    });
    const payment = harden({
      Collateral: E(collateralPurse).withdraw(collateralToLock),
    });
    const seatP = E(zoe).offer(openInvitationP, proposal, payment);
    await seatP;
    const [collateralPayout, runPayout] = await Promise.all([
      E(seatP).getPayout('Collateral'),
      E(seatP).getPayout('RUN'),
    ]);
    await Promise.all([
      E(collateralPurse).deposit(collateralPayout),
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
        Collateral: AmountMath.makeEmpty(collateralBrand),
      },
    };
    const payment = harden({ RUN: E(runPurse).withdraw(runNeeded) });
    const seatP = E(zoe).offer(closeInvitationP, proposal, payment);
    const [runPayout, collateralPayout] = await Promise.all([
      E(seatP).getPayout('RUN'),
      E(seatP).getPayout('Collateral'),
    ]);
    await Promise.all([
      E(runPurse).deposit(runPayout),
      E(collateralPurse).deposit(collateralPayout),
      E(seatP).getOfferResult(),
    ]);
    console.error(`create-vault: vault closed`);
  }

  const agent = Far('vault agent', {
    async doVaultCycle() {
      const vault = await openVault(collateralToLock);
      await closeVault(vault);
      const [newRunBalance, newCollateralBalance] = await Promise.all([
        E(runPurse).getCurrentAmount(),
        E(collateralPurse).getCurrentAmount(),
      ]);
      console.error('create-vault: cycle done');
      return [newRunBalance, newCollateralBalance];
    },
  });

  await E(scratch).set(key, agent);
  console.error('create-vault: ready for cycles');
  return agent;
}
