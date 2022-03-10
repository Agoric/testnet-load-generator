// @ts-check

// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/bundle-source/exported.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/vats/exported.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/wallet/api/exported.js';
// Unfortunately need to dig in internal types for WalletAdminFacet
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/wallet/api/src/internal-types.js';

export {};

/** @typedef {ReturnType<typeof import('@agoric/solo/src/scratch.js').default>} Scratch */
/** @typedef {ReturnType<typeof import('@agoric/spawner').makeSpawner>} Spawner */
/** @typedef {WalletUser & { getAdminFacet: () => WalletAdminFacet }} HomeWallet */

/**
 * @typedef {Object} AttenuatedAMM
 * @property {(issuer: ERef<Issuer>, keyword: Keyword) => Promise<Issuer>} addPool
 * add a new liquidity pool
 * @property {() => Promise<Invitation>} makeSwapInInvitation make an invitation
 * that allows one to do a swap in which the In amount is specified and the Out
 * amount is calculated
 * @property {() => Promise<Invitation>} makeAddLiquidityInvitation make an
 * invitation that allows one to add liquidity to the pool.
 */

/**
 * @typedef {Object} AssetKit
 * @property {string} name
 * @property {Mint} [mint]
 * @property {Issuer} issuer
 * @property {Brand} brand
 * @property {Purse} purse
 */

/**
 * @typedef {Object} Home
 * @property {ERef<NameHub>} agoricNames
 * @property {ERef<unknown>} faucet
 * @property {ERef<Scratch>} scratch
 * @property {ERef<Spawner>} spawner
 * @property {ERef<HomeWallet>} wallet
 * @property {ERef<ZoeService>} zoe
 * @property {ERef<MyAddressNameAdmin>} myAddressNameAdmin
 */

/**
 * @typedef {Object} DeployPowers
 * @property {BundleSource} bundleSource
 */
