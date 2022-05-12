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
 * @typedef { Pick<import('../types').NatAssetKit, 'brand' | 'purse' | 'displayInfo' | 'symbol'>} AssetKit
 * @typedef {{
 *   stableKit: AssetKit,
 *   tokenKit: AssetKit,
 *   vaultFactory: ERef<import('../types').VaultFactoryPublicFacet>,
 *   vaultCollateralManager: ERef<import('../types').VaultCollateralManager> | null,
 *   zoe: ERef<ZoeService>,
 * }} startParam
 */
export default async function startAgent({
  stableKit: {
    brand: stableBrand,
    purse: stablePurse,
    symbol: stableSymbol,
    displayInfo: { decimalPlaces: stableDecimalPlaces },
  },
  tokenKit: {
    brand: collateralBrand,
    purse: collateralPurse,
    displayInfo: { decimalPlaces: collateralDecimalPlaces },
    symbol: collateralSymbol,
  },
  vaultFactory,
  vaultCollateralManager,
  zoe,
}) {
  console.error(`create-vault: setting up tools`);

  const collateralBalance = await getPurseBalance(collateralPurse);
  if (AmountMath.isEmpty(collateralBalance)) {
    throw Error(
      `create-vault: getCurrentAmount(${collateralSymbol}) broken (says 0)`,
    );
  }
  console.error(
    `create-vault: initial balance: ${disp(
      collateralBalance,
      collateralDecimalPlaces,
    )} ${collateralSymbol}`,
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
  assert(cdata);
  const priceRate = cdata.marketPrice;
  const half = makeRatio(BigInt(50), stableBrand);
  const wantedStable = multiplyBy(
    multiplyBy(collateralToLock, priceRate),
    half,
  );

  console.error(`create-vault: tools ready`);

  console.error(
    `create-vault: collateralToLock=${disp(
      collateralToLock,
      collateralDecimalPlaces,
    )} ${collateralSymbol}, wantedStable=${disp(
      wantedStable,
      stableDecimalPlaces,
    )} ${stableSymbol}`,
  );

  // we fix the 1% 'collateralToLock' value at startup, and use it for all cycles
  // (we close over 'collateralToLock')
  async function openVault() {
    console.error('create-vault: cycle: openVault');
    const openInvitationP = vaultCollateralManager
      ? E(vaultCollateralManager).makeVaultInvitation()
      : E(vaultFactory).makeLoanInvitation();
    const proposal = harden({
      give: {
        Collateral: collateralToLock,
      },
      want: {
        [stableSymbol]: wantedStable,
      },
    });
    const payment = harden({
      Collateral: E(collateralPurse).withdraw(collateralToLock),
    });
    const seatP = E(zoe).offer(openInvitationP, proposal, payment);
    await seatP;
    const [collateralPayout, stablePayout] = await Promise.all([
      E(seatP).getPayout('Collateral'),
      E(seatP).getPayout(stableSymbol),
    ]);
    await Promise.all([
      E(collateralPurse).deposit(collateralPayout),
      E(stablePurse).deposit(stablePayout),
    ]);
    const offerResult = await E(seatP).getOfferResult();
    console.error(`create-vault: cycle: vault opened`);
    return offerResult.vault;
  }

  async function closeVault(vault) {
    console.error('create-vault: closeVault');
    const stableNeeded = await fallback(
      E(vault).getCurrentDebt(),
      E(vault).getDebtAmount(),
    );
    const closeInvitationP = E(vault).makeCloseInvitation();
    const proposal = {
      give: {
        [stableSymbol]: stableNeeded,
      },
      want: {
        Collateral: AmountMath.makeEmpty(collateralBrand),
      },
    };
    const payment = harden({
      [stableSymbol]: E(stablePurse).withdraw(stableNeeded),
    });
    const seatP = E(zoe).offer(closeInvitationP, proposal, payment);
    const [stablePayout, collateralPayout] = await Promise.all([
      E(seatP).getPayout(stableSymbol),
      E(seatP).getPayout('Collateral'),
    ]);
    await Promise.all([
      E(stablePurse).deposit(stablePayout),
      E(collateralPurse).deposit(collateralPayout),
      E(seatP).getOfferResult(),
    ]);
    console.error(`create-vault: cycle: vault closed`);
  }

  const agent = Far('vault agent', {
    async doVaultCycle() {
      const vault = await openVault();
      await closeVault(vault);
      const [newStableBalance, newCollateralBalance] = await Promise.all([
        getPurseBalance(stablePurse),
        getPurseBalance(collateralPurse),
      ]);
      console.error('create-vault: cycle: done');
      return {
        newStableBalanceDisplay: disp(newStableBalance, stableDecimalPlaces),
        newCollateralBalanceDisplay: disp(
          newCollateralBalance,
          collateralDecimalPlaces,
        ),
        stableSymbol,
        collateralSymbol,
      };
    },
  });

  console.error('create-vault: ready for cycles');
  return agent;
}
