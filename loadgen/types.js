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
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/inter-protocol/exported.js';

export {};

/** @typedef {ReturnType<typeof import('@agoric/solo/src/scratch.js').default>} Scratch */
/** @typedef {ReturnType<typeof import('@agoric/spawner').makeSpawner>} Spawner */
/** @typedef {WalletUser & { getAdminFacet: () => WalletAdminFacet }} HomeWallet */

/** @typedef { import('@agoric/inter-protocol/src/vaultFactory/vaultFactory').VaultFactoryContract['publicFacet']} VaultFactoryPublicFacet */
/** @typedef { import('@agoric/inter-protocol/src/vaultFactory/vaultManager').CollateralManager} VaultCollateralManager */
/** @typedef { import('@agoric/zoe/tools/priceAuthorityRegistry').PriceAuthorityRegistryAdmin } PriceAuthorityRegistryAdmin */

/**
 * @typedef { Pick<
 *   XYKAMMPublicFacet,
 *   'getPriceAuthorities' | 'makeSwapInInvitation' | 'makeAddLiquidityInvitation'
 * > & {
 *   addPool?: (issuer: ERef<Issuer>, keyword: Keyword) => Promise<Issuer>;
 *   addIssuer?: (issuer: ERef<Issuer>, keyword: Keyword) => Promise<Issuer>;
 *   addPoolInvitation?: () => Promise<Invitation>;
 * } } AttenuatedAMM
 */

/**
 * @template {AssetKind} [K=AssetKind]
 * @typedef {object} AssetKit
 * @property {string} symbol
 * @property {Mint<K>} [mint]
 * @property {Issuer<K>} issuer
 * @property {Brand<K>} brand
 * @property {DisplayInfo<K>} displayInfo
 * @property {Purse} purse
 */

/** @typedef {AssetKit<'nat'>} NatAssetKit */

/**
 * @typedef {object} Home
 * @property {ERef<NameHub>} agoricNames
 * @property {ERef<unknown>} faucet
 * @property {ERef<Scratch>} scratch
 * @property {ERef<Spawner>} spawner
 * @property {ERef<VaultFactory>} [vaultFactoryCreatorFacet]
 * @property {ERef<PriceAuthorityRegistryAdmin>} [priceAuthorityAdminFacet]
 * @property {ERef<HomeWallet>} wallet
 * @property {ERef<ZoeService>} zoe
 * @property {ERef<MyAddressNameAdmin>} myAddressNameAdmin
 */

/** @typedef {import('agoric/src/publish').Bundle} Bundle */

/**
 * @typedef {object} DeployPowers
 * @property {BundleSource} bundleSource
 * @property {import('agoric/src/publish').PublishBundle} [publishBundle]
 */
