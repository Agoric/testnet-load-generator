import path from 'path';

import { E } from '@agoric/eventual-send';

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);
/** @param {string[]} paths */
export const pathResolveShim = (...paths) => path.resolve(dirname, ...paths);

/**
 * Create and save the loadgen kit if necessary
 *
 * @param { ERef<Pick<import('./types').Home, 'zoe'>> } home
 * @param { import('./types').DeployPowers } powers
 * @param {object} [options]
 * @param {boolean} [options.mustPublish]
 */
export const makeInstall = async (home, powers, { mustPublish } = {}) => {
  if (mustPublish && !powers.publishBundle) {
    throw Error('publishBundle power required for publishing contract bundle');
  }
  try {
    const { makeHelpers } = await import('@agoric/deploy-script-support');
    const { install } = await makeHelpers(home, powers);
    return install;
  } catch (e) {
    if (mustPublish) {
      const error = Error(
        'deploy-script-support failed, cannot publish bundle',
      );
      Object.defineProperty(error, 'cause', {
        value: e,
        configurable: true,
        enumerable: true,
      });
      throw error;
    }
    const { bundleSource, pathResolve = pathResolveShim } = powers;
    const { zoe } = E.get(home);
    /** @param {string} contractPath */
    const install = async (contractPath) => {
      const resolvedPath = pathResolve
        ? pathResolve(contractPath)
        : contractPath;
      const bundle = await bundleSource(resolvedPath);
      // Do not use `publishBundle` here as most agoric-sdk versions that do not have a compatible
      // @agoric/deploy-script-support package also have a broken `publishBundle` power
      const installation = await E(zoe).install(bundle);
      // Do not bother with board id or installation manager since we don't use these
      return { installation };
    };

    return install;
  }
};
