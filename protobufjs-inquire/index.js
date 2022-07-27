/* global module */

'use strict';

const modules = new Map();

/**
 * Requires a module only if available.
 *
 * @memberof util
 * @param {string} moduleName Module to require
 * @returns {?Object} Required module if available and not empty, otherwise `null`
 */
function inquire(moduleName) {
  let mod = modules.get(moduleName) || null;
  if (!mod) {
    if (modules.size === 0) {
      try {
        // eslint-disable-next-line no-eval
        mod = eval('require')(moduleName);
      } catch (e) {
        // Ignore
      }
    }
    console.log(
      `inquire doesn't have registered module '${moduleName}'.${
        mod ? ' Using require fallback.' : ''
      }`,
    );
  }
  return mod;
}

/**
 * Requires a module only if available.
 *
 * @memberof util.inquire
 * @param {string} moduleName Module name to register
 * @param {object} mod corresponding module object
 */
function register(moduleName, mod) {
  modules.set(moduleName, mod);
}

module.exports = inquire;
inquire.register = register;
