// @ts-check

import { AmountMath, AssetKind } from '@agoric/ertp';
import { E } from '@agoric/eventual-send';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';

import { pursePetnames, issuerPetnames } from './petnames.js';
import { allValues } from './allValues.js';

import '@agoric/zoe/exported.js';
import { disp } from './display.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/** @typedef {Awaited<ReturnType<typeof startAgent>>} LoadgenKit */
/**
 * @typedef {{
 *   agoricNames: ERef<NameHub>,
 *   faucet: ERef<any>,
 *   wallet: ERef<import('../types.js').HomeWallet>,
 *   zoe: ERef<ZoeService>,
 *   mintBundle: BundleSource,
 * }} startParam
 */

const tokenBrandPetname = 'LGT';

// This is loaded by the spawner into a new 'spawned' vat on the solo node.
// The default export function is called with some args.

/**
 * @param {startParam} param
 */
export default async function startAgent({
  agoricNames,
  faucet,
  zoe,
  wallet,
  mintBundle,
}) {
  const walletAdmin = E(wallet).getAdminFacet();

  // Get the RUN purse and initial balance from the wallet
  // This shouldn't require, on its own, any requests to the chain as
  // it just waits until the wallet bootstrap is sufficiently advanced
  const { runKit, runBalance: initialRunBalance } = E.get(
    (async () => {
      const purseNotifier = E(walletAdmin).getPursesNotifier();
      const pursesStatesUpdates = makeAsyncIterableFromNotifier(purseNotifier);

      /** @type {PursesFullState | undefined} */
      let runPurseState;
      for await (const pursesStates of pursesStatesUpdates) {
        runPurseState = pursesStates.find(
          ({ brandPetname, pursePetname }) =>
            brandPetname === 'RUN' && pursePetname === pursePetnames.RUN,
        );
        if (runPurseState) {
          console.error('prepare-loadgen: Found RUN purse', runPurseState);
          break;
        }
      }

      const runIssuer = E(wallet).getIssuer(issuerPetnames.RUN);

      return {
        /** @type {Promise<import('../types.js').AssetKit>} */
        runKit: allValues({
          issuer: runIssuer,
          brand: runPurseState.brand,
          purse: runPurseState.purse,
          name: 'RUN',
        }),
        runBalance: /** @type {Amount<NatValue>} */ (
          AmountMath.make(
            runPurseState.brand,
            runPurseState.currentAmount.value,
          )
        ),
      };
    })(),
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
    const feePayment = E(runPurse).withdraw(thirdRunAmount);

    const remainingBalance = /** @type {Promise<Amount<NatValue>>} */ (
      E(runPurse).getCurrentAmount()
    );
    await E.when(feePayment, E(feePurse).deposit);

    return remainingBalance;
  })();

  // Use Zoe to install mint for loadgen token, return kit
  // Needs fee purse to be provisioned
  /** @type {Promise<import('../types.js').AssetKit>} */
  const tokenKit = E.when(runBalance, () => {
    console.error(
      `prepare-loadgen: installing mint bundle and doing startInstance`,
    );

    /** @type {import('./mintHolder.js').CustomTerms} */
    const customTerms = {
      assetKind: AssetKind.NAT,
      displayInfo: {
        decimalPlaces: 6,
        assetKind: AssetKind.NAT,
      },
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
  const ammInstance = Promise.allSettled([
    E(agoricNames).lookup('instance', 'amm'),
    E(agoricNames).lookup('instance', 'autoswap'),
  ]).then(([ammResult, autoswapResult]) => {
    if (ammResult.status === 'fulfilled') {
      return ammResult.value;
    } else if (autoswapResult.status === 'fulfilled') {
      return autoswapResult.value;
    } else {
      assert.fail(
        assert.details`Failed to get either amm (${ammResult.reason}) or autoswap (${autoswapResult.reason}) instances.`,
      );
    }
  });
  /** @type {ERef<import('../types.js').AttenuatedAMM>} */
  const amm = E(zoe).getPublicFacet(ammInstance);

  const fundingResult = E.when(runBalance, async (centralInitialBalance) => {
    const { purse: centralPurse } = E.get(runKit);
    const {
      mint: secondaryMint,
      issuer: secondaryIssuer,
      brand: secondaryBrandP,
      purse: secondaryPurse,
    } = E.get(tokenKit);
    const liquidityIssuer = E(amm).addPool(
      secondaryIssuer,
      issuerPetnames[tokenBrandPetname],
    );
    const liquidityBrandP = E(liquidityIssuer).getBrand();

    if (AmountMath.isEmpty(centralInitialBalance)) {
      throw Error(`no RUN, loadgen cannot proceed`);
    }

    /** @type {Amount<NatValue>} */
    const centralAmount = AmountMath.make(
      centralInitialBalance.brand,
      centralInitialBalance.value / 2n,
    );
    const centralPerCycle = AmountMath.make(
      centralAmount.brand,
      centralAmount.value / 100n,
    );
    const centralPayment = E(centralPurse).withdraw(centralAmount);

    // Each amm and vault cycle temporarily uses 1% of holdings
    // The faucet task taps 100_000n of the loadgen token
    // We want the faucet to represent a fraction (1% ?) of the traded amounts
    // The computed amount will be used for both amm liquidity and initial purse funds
    const secondaryBrand = await secondaryBrandP;
    /** @type {Amount<NatValue>} */
    const secondaryAmount = AmountMath.make(
      secondaryBrand,
      100n * 100n * 100_000n,
    );
    const secondaryPerCycle = AmountMath.make(
      secondaryAmount.brand,
      secondaryAmount.value / 100n,
    );
    const secondaryAMMPayment = E(secondaryMint).mintPayment(secondaryAmount);
    const secondaryPursePayment = E(secondaryMint).mintPayment(secondaryAmount);

    const depositInitialSecondaryResult = E.when(
      secondaryPursePayment,
      E(secondaryPurse).deposit,
    );

    console.error(
      `prepare-loadgen: Adding AMM liquidity. Will trade about ${disp(
        centralPerCycle,
      )} RUN and ${disp(secondaryPerCycle)} ${tokenBrandPetname} per cycle`,
    );

    const liquidityBrand = await liquidityBrandP;

    const proposal = harden({
      want: { Liquidity: AmountMath.makeEmpty(liquidityBrand) },
      give: { Secondary: secondaryAmount, Central: centralAmount },
    });

    const addLiquiditySeat = E(zoe).offer(
      E(amm).makeAddLiquidityInvitation(),
      proposal,
      harden({
        Secondary: secondaryAMMPayment,
        Central: centralPayment,
      }),
    );

    const addLiquidityResult = E(addLiquiditySeat).getOfferResult();

    await Promise.all([depositInitialSecondaryResult, addLiquidityResult]);
  });

  await fundingResult;
  return harden(await allValues({ tokenKit, runKit, amm }));

  // TODO: exit here?
}
