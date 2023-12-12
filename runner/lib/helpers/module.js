import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import { promises as fs } from 'fs';

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
      const resolved = await import.meta.resolve(specified, parent);
      await fs.stat(fileURLToPath(resolved));
      return resolved;
    }
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    switch (err.code) {
      case 'ENOENT':
        return undefined;
      case 'MODULE_NOT_FOUND':
        break;
      default:
        throw err;
    }
    // Fall-through
  }

  const require = createRequire(parent);

  return pathToFileURL(require.resolve(specified)).href;
};
