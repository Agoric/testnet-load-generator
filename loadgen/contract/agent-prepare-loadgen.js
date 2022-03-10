// @ts-check

import { AmountMath, AssetKind } from '@agoric/ertp';
import { E } from '@agoric/eventual-send';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';

import { pursePetnames, issuerPetnames } from './petnames.js';
import { allValues } from './allValues.js';

import { disp } from './display.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/** @typedef {Awaited<ReturnType<typeof startAgent>>} LoadgenKit */
/**
 * @typedef {{
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
export default async function startAgent({ faucet, zoe, wallet, mintBundle }) {
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

  return harden(await allValues({ tokenKit, runKit }));

  // TODO: exit here?
}
