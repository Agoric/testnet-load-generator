import { createRequire } from 'module';
import { pathToFileURL } from 'url';

/**
 *
 * @param {string} specified
 * @param {string | URL} parent
 */
export const resolve = async (specified, parent) => {
  if (!parent) {
    throw new TypeError('Invalid parent');
  }
  try {
    if (import.meta.resolve) {
      return await import.meta.resolve(specified, parent);
    }
  } catch (err) {
    // Fall-through
  }

  const require = createRequire(parent);

  return pathToFileURL(require.resolve(specified)).href;
};
