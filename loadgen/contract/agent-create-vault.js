// @ts-check

import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { AmountMath } from '@agoric/ertp';
// import { allComparable } from '@agoric/same-structure';
import * as contractSupport from '@agoric/zoe/src/contractSupport/index.js';
import { disp } from './display.js';
import { fallback } from './fallback.js';

const makeRatio = contractSupport.makeRatio;
const multiplyBy =
  contractSupport.floorMultiplyBy ||
  // @ts-expect-error backwards compat
  contractSupport.multiplyBy;

/** @param {Purse} purse */
async function getPurseBalance(purse) {
  return /** @type {Promise<Amount<'nat'>>} */ (E(purse).getCurrentAmount());
}

/**
 * This is loaded by the spawner into a new 'spawned' vat on the solo node.
 * The default export function is called with some args.
 *
 * @param {startParam} param
 * @typedef {Awaited<ReturnType<typeof startAgent>>} Agent
 * @typedef { Pick<import('../types').NatAssetKit, 'brand' | 'purse' | 'displayInfo' | 'name'>} AssetKit
 * @typedef {{
 *   runKit: AssetKit,
 *   tokenKit: AssetKit,
 *   vaultFactory: ERef<import('../types').VaultFactoryPublicFacet>,
 *   zoe: ERef<ZoeService>,
 * }} startParam
 */
export default async function startAgent({
  runKit: {
    brand: runBrand,
    purse: runPurse,
    displayInfo: { decimalPlaces: runDecimalPlaces },
  },
  tokenKit: {
    brand: collateralBrand,
    purse: collateralPurse,
    displayInfo: { decimalPlaces: collateralDecimalPlaces },
    name: collateralToken,
  },
  vaultFactory,
  zoe,
}) {
  console.error(`create-vault: setting up tools`);

  const collateralBalance = await getPurseBalance(collateralPurse);
  if (AmountMath.isEmpty(collateralBalance)) {
    throw Error(
      `create-vault: getCurrentAmount(${collateralToken}) broken (says 0)`,
    );
  }
  console.error(
    `create-vault: initial balance: ${disp(
      collateralBalance,
      collateralDecimalPlaces,
    )} ${collateralToken}`,
  );
  // put 1% into the vault
  const collateralToLock = AmountMath.make(
    collateralBrand,
    collateralBalance.value / BigInt(100),
  );

  // we only withdraw half the value of the collateral, giving us 200%
  // collateralization
  const collaterals = await E(vaultFactory).getCollaterals();
  const cdata = collaterals.find((c) => c.brand === collateralBrand);
  const priceRate = cdata.marketPrice;
  const half = makeRatio(BigInt(50), runBrand);
  const wantedRun = multiplyBy(multiplyBy(collateralToLock, priceRate), half);

  console.error(`create-vault: tools ready`);

  console.error(
    `create-vault: collateralToLock=${disp(
      collateralToLock,
      collateralDecimalPlaces,
    )} ${collateralToken}, wantedRun=${disp(wantedRun, runDecimalPlaces)}`,
  );

  // we fix the 1% 'collateralToLock' value at startup, and use it for all cycles
  // (we close over 'collateralToLock')
  async function openVault() {
    console.error('create-vault: cycle: openVault');
    const openInvitationP = E(vaultFactory).makeVaultInvitation();
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
    console.error(`create-vault: cycle: vault opened`);
    return offerResult.vault;
  }

  async function closeVault(vault) {
    console.error('create-vault: closeVault');
    const runNeeded = await fallback(
      E(vault).getCurrentDebt(),
      E(vault).getDebtAmount(),
    );
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
    console.error(`create-vault: cycle: vault closed`);
  }

  const agent = Far('vault agent', {
    async doVaultCycle() {
      const vault = await openVault();
      await closeVault(vault);
      const [newRunBalance, newCollateralBalance] = await Promise.all([
        getPurseBalance(runPurse),
        getPurseBalance(collateralPurse),
      ]);
      console.error('create-vault: cycle: done');
      return {
        newRunBalanceDisplay: disp(newRunBalance, runDecimalPlaces),
        newCollateralBalanceDisplay: disp(
          newCollateralBalance,
          collateralDecimalPlaces,
        ),
        collateralToken,
      };
    },
  });

  console.error('create-vault: ready for cycles');
  return agent;
}
