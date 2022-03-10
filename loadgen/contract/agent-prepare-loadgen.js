// @ts-check

import { AssetKind } from '@agoric/ertp';
import { E } from '@agoric/eventual-send';

import { pursePetnames, issuerPetnames } from './petnames.js';
import { allValues } from './allValues.js';

/** @template T @typedef {import('@agoric/eventual-send').ERef<T>} ERef */

/** @typedef {Awaited<ReturnType<typeof startAgent>>} LoadgenKit */
/**
 * @typedef {{
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
export default async function startAgent({ zoe, wallet, mintBundle }) {
  const walletAdmin = E(wallet).getAdminFacet();

  // Use Zoe to install mint for loadgen token, return kit
  /** @type {Promise<import('../types.js').NatAssetKit>} */
  const tokenKit = E.when(undefined, () => {
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

  return harden(await allValues({ tokenKit }));

  // TODO: exit here?
}
