// @ts-check

import { makeIssuerKit } from '@agoric/ertp';

/**
 * This contract holds one mint.
 *
 * @param {ContractFacet} zcf
 * @returns {{ publicFacet: Issuer, creatorFacet: Mint}}
 * @typedef {{
 *   keyword: string,
 *   assetKind?: AssetKind | undefined,
 *   displayInfo?: DisplayInfo | undefined,
 * }} CustomTerms
 */
export const start = (zcf) => {
  /** @type {CustomTerms} */
  const { keyword, assetKind, displayInfo } = /** @type {*} */ (zcf.getTerms());

  const { mint, issuer } = makeIssuerKit(keyword, assetKind, displayInfo);

  return {
    publicFacet: issuer,
    creatorFacet: mint,
  };
};
harden(start);
