// @ts-check

import { AmountMath, AssetKind } from '@agoric/ertp';
import { E } from '@agoric/eventual-send';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';
import { makeRatio } from '@agoric/zoe/src/contractSupport';

import { pursePetnames, issuerPetnames } from './petnames.js';
import { allValues } from './allValues.js';

import { disp } from './display.js';
import { fallback } from './fallback.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/** @typedef {Awaited<ReturnType<typeof startAgent>>} LoadgenKit */
/**
 * @typedef {{
 *   agoricNames: ERef<NameHub>,
 *   priceAuthorityAdminFacet: ERef<import('../types.js').PriceAuthorityRegistryAdmin | void>,
 *   faucet: ERef<any>,
 *   vaultFactoryCreatorFacet: ERef<VaultFactory | void>,
 *   wallet: ERef<import('../types.js').HomeWallet>,
 *   zoe: ERef<ZoeService>,
 *   mintBundle: BundleSource,
 *   fallbackCollateralToken?: string | undefined,
 *   fallbackTradeToken?: string | undefined,
 * }} startParam
 */

const tokenBrandPetname = 'LGT';
const BASIS_POINTS = 10000n;

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

/**
 * @param {Object} param0
 * @param {ERef<WalletUser>} param0.wallet
 * @param {ERef<WalletAdminFacet>} param0.walletAdmin
 */
const makePurseFinder = ({ wallet, walletAdmin }) => {
  const purseNotifier = E(walletAdmin).getPursesNotifier();
  const pursesStatesUpdates = makeAsyncIterableFromNotifier(purseNotifier);

  /** @type {PursesFullState[][]} */
  const previousPursesStatesUpdates = [];

  return harden({
    /**
     * @param {Object} param0
     * @param {string} param0.brandPetname
     * @param {boolean} [param0.existingOnly]
     */
    async find({ brandPetname, existingOnly = false }) {
      /** @type {PursesFullState | undefined} */
      let foundPurseState;

      /** @param {PursesFullState[]} pursesStates */
      const findPurse = (pursesStates) => {
        foundPurseState = pursesStates.find(
          ({ brandPetname: candidateBrand, pursePetname: candidatePurse }) =>
            candidateBrand === issuerPetnames[brandPetname] &&
            candidatePurse === pursePetnames[brandPetname],
        );
        if (foundPurseState) {
          console.error(
            `prepare-loadgen: Found ${brandPetname} purse`,
            foundPurseState,
          );
          return true;
        }
        return false;
      };

      for (const pursesStates of previousPursesStatesUpdates) {
        if (findPurse(pursesStates)) {
          break;
        }
      }

      if (!foundPurseState) {
        if (existingOnly) {
          return { kit: undefined, balance: undefined };
        }

        for await (const pursesStates of pursesStatesUpdates) {
          previousPursesStatesUpdates.push(pursesStates);
          if (findPurse(pursesStates)) {
            break;
          }
        }

        // pursesStatesUpdates is an infinite iterable so
        // the above loop will not exit until it finds a purse
      }

      const issuer = E(wallet).getIssuer(issuerPetnames[brandPetname]);

      return {
        /** @type {Promise<import('../types.js').NatAssetKit>} */
        kit: allValues({
          issuer,
          brand: foundPurseState.brand,
          purse: foundPurseState.purse,
          name: brandPetname,
          displayInfo: foundPurseState.displayInfo,
        }),
        balance: /** @type {Amount<'nat'>} */ (
          AmountMath.make(
            foundPurseState.brand,
            foundPurseState.currentAmount.value,
          )
        ),
      };
    },
  });
};

/**
 * @param {startParam} param
 */
export default async function startAgent({
  agoricNames,
  faucet,
  priceAuthorityAdminFacet,
  vaultFactoryCreatorFacet,
  zoe,
  wallet,
  mintBundle,
  fallbackTradeToken,
  fallbackCollateralToken,
}) {
  const walletAdmin = E(wallet).getAdminFacet();

  const purseFinder = makePurseFinder({ wallet, walletAdmin });

  // Get the RUN purse and initial balance from the wallet
  // This shouldn't require, on its own, any requests to the chain as
  // it just waits until the wallet bootstrap is sufficiently advanced
  const { kit: runKit, balance: initialRunBalance } = E.get(
    purseFinder.find({ brandPetname: 'RUN' }),
  );

  // Setup the fee purse if necessary and get the remaining RUN balance
  const runBalance = (async () => {
    const feePurse = await E(faucet)
      .getFeePurse()
      .catch((err) => {
        if (err.name !== 'TypeError') {
          throw err;
        } else {
          return null;
        }
      });

    if (!feePurse) {
      return initialRunBalance;
    }

    const run = await initialRunBalance;
    const thirdRunAmount = AmountMath.make(run.brand, run.value / 3n);

    if (AmountMath.isEmpty(run)) {
      throw Error(`no RUN, loadgen cannot proceed`);
    }

    console.error(
      `prepare-loadgen: depositing ${disp(thirdRunAmount)} into the fee purse`,
    );
    const runPurse = E.get(runKit).purse;
    // Purse doesn't "lock" during withdrawal so we need to
    // wait on payment before asking about balance
    const feePayment = await E(runPurse).withdraw(thirdRunAmount);

    const remainingBalance = /** @type {Promise<Amount<'nat'>>} */ (
      E(runPurse).getCurrentAmount()
    );
    await E(feePurse).deposit(feePayment);

    return remainingBalance;
  })();

  /**
   * @template T
   * @param {PromiseLike<T>} promise
   */
  const withFee = async (
    promise = /** @type {Promise<any>} */ (Promise.resolve()),
  ) => Promise.all([promise, runBalance]).then(([value]) => value);

  // Use Zoe to install mint for loadgen token, return kit
  // Needs fee purse to be provisioned
  /** @type {Promise<import('../types.js').NatAssetKit>} */
  const tokenKit = E.when(withFee(), () => {
    console.error(
      `prepare-loadgen: installing mint bundle and doing startInstance`,
    );

    const displayInfo = {
      decimalPlaces: 6,
      assetKind: AssetKind.NAT,
    };

    /** @type {import('./mintHolder.js').CustomTerms} */
    const customTerms = {
      assetKind: AssetKind.NAT,
      displayInfo,
      keyword: tokenBrandPetname,
    };

    const installation = E(zoe).install(mintBundle);

    /** @type {Promise<ReturnType<typeof import('./mintHolder.js').start>>} */
    const startInstanceResult = E(zoe).startInstance(
      installation,
      undefined,
      customTerms,
    );

    const { creatorFacet: mint, publicFacet: issuer } =
      E.get(startInstanceResult);

    return allValues({
      name: tokenBrandPetname,
      displayInfo,
      mint,
      issuer,
      brand: E(issuer).getBrand(),
      purse: (async () => {
        const issuerPetname = issuerPetnames[tokenBrandPetname];
        const pursePetname = pursePetnames[tokenBrandPetname];
        await E(walletAdmin).addIssuer(issuerPetname, await issuer);
        await E(walletAdmin).makeEmptyPurse(issuerPetname, pursePetname);
        return E(wallet).getPurse(pursePetname);
      })(),
    });
  });

  /** @type {ERef<Instance>} */
  const ammInstance = fallback(
    E(agoricNames).lookup('instance', 'amm'),
    E(agoricNames).lookup('instance', 'autoswap'),
  );
  // Use `when` as older versions of agoric-sdk cannot accept a promise
  // See https://github.com/Agoric/agoric-sdk/issues/3837
  /** @type {ERef<import('../types.js').AttenuatedAMM>} */
  const amm = E.when(withFee(ammInstance), E(zoe).getPublicFacet);

  /** @type {(() => Promise<Amount<'nat'>>)[]} */
  const recoverFunding = [];
  const fundingResult = E.when(runBalance, async (centralInitialBalance) => {
    const { purse: centralPurse } = E.get(runKit);
    const {
      mint: secondaryMint,
      issuer: secondaryIssuer,
      brand: secondaryBrandP,
      purse: secondaryPurse,
    } = E.get(tokenKit);
    const liquidityIssuer = fallback(
      E(amm).addIssuer(secondaryIssuer, issuerPetnames[tokenBrandPetname]),
      E(amm).addPool(secondaryIssuer, issuerPetnames[tokenBrandPetname]),
    );
    const liquidityBrandP = E(liquidityIssuer).getBrand();

    if (AmountMath.isEmpty(centralInitialBalance)) {
      throw Error(`no RUN, loadgen cannot proceed`);
    }

    /** @type {Amount<'nat'>} */
    const centralAmount = AmountMath.make(
      centralInitialBalance.brand,
      centralInitialBalance.value / 2n,
    );
    const centralPayment = E(centralPurse).withdraw(centralAmount);
    recoverFunding.push(async () =>
      E.when(centralPayment, E(centralPurse).deposit),
    );

    // Each amm and vault cycle temporarily uses 1% of holdings
    // The faucet task taps 100_000n of the loadgen token
    // We want the faucet to represent a fraction (1% ?) of the traded amounts
    // The computed amount will be used for both amm liquidity and initial purse funds
    const secondaryBrand = await secondaryBrandP;
    /** @type {Amount<'nat'>} */
    const secondaryAmount = AmountMath.make(
      secondaryBrand,
      100n * 100n * 100_000n,
    );
    const secondaryAMMPayment = E(secondaryMint).mintPayment(secondaryAmount);
    const secondaryPursePayment = E(secondaryMint).mintPayment(secondaryAmount);

    const depositInitialSecondaryResult = E.when(
      secondaryPursePayment,
      E(secondaryPurse).deposit,
    );
    recoverFunding.push(async () =>
      E.when(secondaryAMMPayment, E(secondaryPurse).deposit),
    );

    console.error(
      `prepare-loadgen: Adding AMM liquidity: ${disp(
        centralAmount,
      )} RUN and ${disp(secondaryAmount)} ${tokenBrandPetname}`,
    );

    const liquidityBrand = await liquidityBrandP;

    const proposal = harden({
      want: { Liquidity: AmountMath.makeEmpty(liquidityBrand) },
      give: { Secondary: secondaryAmount, Central: centralAmount },
    });

    const addLiquiditySeat = E(zoe).offer(
      fallback(E(amm).addPoolInvitation(), E(amm).makeAddLiquidityInvitation()),
      proposal,
      harden({
        Secondary: secondaryAMMPayment,
        Central: centralPayment,
      }),
    );

    const addLiquidityResult = E(addLiquiditySeat).getOfferResult();

    await Promise.all([depositInitialSecondaryResult, addLiquidityResult]);

    return true;
  }).catch(async (err) => {
    console.error('prepare-loadgen: failed to fund amm', err);
    await Promise.all(recoverFunding.map((recover) => recover())).catch(
      (recoverError) => {
        console.error(
          'prepare-loadgen: failed to recover funding',
          recoverError,
        );
      },
    );
    return false;
  });

  /** @type {ERef<Instance>} */
  const vaultFactoryInstance = fallback(
    E(agoricNames).lookup('instance', 'VaultFactory'),
    E(agoricNames).lookup('instance', 'Treasury'),
  );
  // Use `when` as older versions of agoric-sdk cannot accept a promise
  // See https://github.com/Agoric/agoric-sdk/issues/3837
  /** @type {ERef<import('../types.js').VaultFactoryPublicFacet>} */
  const vaultFactoryPublicFacet = E.when(
    withFee(vaultFactoryInstance),
    E(zoe).getPublicFacet,
  );

  const vaultManager = E.when(
    Promise.all([
      priceAuthorityAdminFacet,
      vaultFactoryCreatorFacet,
      fundingResult,
    ]),
    async ([priceAuthorityAdmin, vaultFactory, ammFunded]) => {
      if (!priceAuthorityAdmin || !vaultFactory) {
        console.error(
          'prepare-loadgen: vaultFactoryCreator and priceAuthorityAdmin not available',
        );
        return null;
      }

      if (!ammFunded) {
        return null;
      }

      const { brand: collateralBrand, issuer: collateralIssuer } =
        await tokenKit;
      const { brand: centralBrand } = await runKit;

      const { toCentral, fromCentral } = E.get(
        E(amm).getPriceAuthorities(collateralBrand),
      );

      await Promise.all([
        E(priceAuthorityAdmin).registerPriceAuthority(
          toCentral,
          collateralBrand,
          centralBrand,
        ),
        E(priceAuthorityAdmin).registerPriceAuthority(
          fromCentral,
          centralBrand,
          collateralBrand,
        ),
      ]);

      const rates = {
        debtLimit: AmountMath.make(centralBrand, 100_000_000_000n),
        liquidationMargin: makeRatio(105n, centralBrand),
        liquidationPenalty: makeRatio(10n, centralBrand, 100n, centralBrand),
        interestRate: makeRatio(250n, centralBrand, BASIS_POINTS),
        loanFee: makeRatio(200n, centralBrand, BASIS_POINTS),
      };

      return E(vaultFactory).addVaultType(
        collateralIssuer,
        issuerPetnames[tokenBrandPetname],
        rates,
      );
    },
  );

  return E.when(vaultManager, async (vaultManagerPresence) => {
    const collateralTokenPetname =
      fallbackCollateralToken || fallbackTradeToken;

    if (vaultManagerPresence) {
      return { vaultTokenKit: tokenKit, ammTokenKit: tokenKit };
    } else if (collateralTokenPetname) {
      // Make sure the finder knows about all purses by finding the
      // LGT purse we created
      await purseFinder.find({ brandPetname: tokenBrandPetname });

      const { kit: vaultTokenKit } = E.get(
        purseFinder.find({
          brandPetname: collateralTokenPetname,
          existingOnly: true,
        }),
      );

      let ammTokenKit = vaultTokenKit.then((value) => value || tokenKit);
      if (
        (fallbackTradeToken && fallbackTradeToken !== collateralTokenPetname) ||
        !(await fundingResult)
      ) {
        ({ kit: ammTokenKit } = E.get(
          purseFinder.find({
            brandPetname: fallbackTradeToken,
            existingOnly: true,
          }),
        ));
      }

      return { vaultTokenKit, ammTokenKit };
    } else {
      return { vaultTokenKit: null, ammTokenKit: null };
    }
  }).then(async ({ vaultTokenKit, ammTokenKit }) =>
    harden(
      await allValues({
        tokenKit,
        runKit,
        amm,
        ammTokenKit,
        vaultManager,
        vaultFactory: vaultFactoryPublicFacet,
        vaultTokenKit,
      }),
    ),
  );

  // TODO: exit here?
}
