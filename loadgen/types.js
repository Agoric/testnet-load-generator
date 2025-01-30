// @ts-check

// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/bundle-source/src/types.js';
// Unfortunately need to dig in internal types for WalletAdminFacet
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/wallet/api/src/internal-types.js';

/// <reference types="@agoric/vats/src/core/types-ambient"/>
/// <reference types="@agoric/wallet/api/src/types-ambient"/>
/// <reference types="@agoric/zoe/src/contractFacet/types-ambient"/>
/// <reference types="@agoric/inter-protocol/src/vaultFactory/types-ambient"/>

export {};

/** @typedef {ReturnType<typeof import('@agoric/internal/src/scratch.js').default>} Scratch */
/** @typedef {ReturnType<typeof import('@agoric/spawner').makeSpawner>} Spawner */
/** @typedef {WalletUser & { getAdminFacet: () => WalletAdminFacet }} HomeWallet */

/** @typedef { import('@agoric/inter-protocol/src/vaultFactory/vaultFactory').VaultFactoryContract['publicFacet']} VaultFactoryPublicFacet */
/** @typedef { import('@agoric/inter-protocol/src/vaultFactory/vaultManager').CollateralManager} VaultCollateralManager */
/** @typedef { import('@agoric/vats/src/priceAuthorityRegistry').PriceAuthorityRegistryAdmin } PriceAuthorityRegistryAdmin */

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
 * @property {ERef<import('@agoric/vats').NameHub>} agoricNames
 * @property {ERef<unknown>} faucet
 * @property {ERef<Scratch>} scratch
 * @property {ERef<Spawner>} spawner
 * @property {ERef<VaultFactoryCreatorFacet>} [vaultFactoryCreatorFacet]
 * @property {ERef<PriceAuthorityRegistryAdmin>} [priceAuthorityAdminFacet]
 * @property {ERef<HomeWallet>} wallet
 * @property {ERef<ZoeService>} zoe
 * @property {ERef<import('@agoric/vats').MyAddressNameAdmin>} myAddressNameAdmin
 */

/**
 * @typedef {object} DeployPowers
 * @property {BundleSource} bundleSource
 * @property {(...paths: string[]) => string} [pathResolve]
 * @property {import('agoric/src/publish').PublishBundle} [publishBundle]
 */
