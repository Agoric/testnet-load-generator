// @ts-check

// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/bundle-source/src/types.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/vats/exported.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/wallet/api/exported.js';
// Unfortunately need to dig in internal types for WalletAdminFacet
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/wallet/api/src/internal-types.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/zoe/src/contractFacet/types.js';

export {};

/** @typedef {ReturnType<typeof import('@agoric/solo/src/scratch.js').default>} Scratch */
/** @typedef {ReturnType<typeof import('@agoric/spawner').makeSpawner>} Spawner */
/** @typedef {WalletUser & { getAdminFacet: () => WalletAdminFacet }} HomeWallet */

/**
 * @typedef { Pick<
 *   XYKAMMPublicFacet,
 *   'makeSwapInInvitation' | 'makeAddLiquidityInvitation'
 * > & {
 *   addPool: (issuer: ERef<Issuer>, keyword: Keyword) => Promise<Issuer>
 * } } AttenuatedAMM
 */

/**
 * @template {AssetKind} [K=AssetKind]
 * @typedef {Object} AssetKit
 * @property {string} name
 * @property {Mint<K>} [mint]
 * @property {Issuer<K>} issuer
 * @property {Brand<K>} brand
 * @property {DisplayInfo<K>} displayInfo
 * @property {Purse} purse
 */

/** @typedef {AssetKit<'nat'>} NatAssetKit */

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
