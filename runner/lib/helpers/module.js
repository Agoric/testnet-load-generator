import { createRequire } from 'module';
import { pathToFileURL } from 'url';

/**
 *
 * @param {string} specified
 * @param {string | URL} parent
 */
export const resolve = async (specified, parent) => {
  if (!parent) throw new TypeError('Invalid parent');

  const require = createRequire(parent);
  return pathToFileURL(require.resolve(specified)).href;
};
