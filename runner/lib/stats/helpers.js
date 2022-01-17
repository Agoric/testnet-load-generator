import { makeRounder } from '../helpers/time.js';

/**
 * @param {readonly [PropertyKey, () => any][]} entries
 */
const makeGetterObject = (entries) =>
  harden(
    Object.create(
      null,
      Object.fromEntries(
        entries.map(([key, get]) => [key, { get, enumerable: true }]),
      ),
    ),
  );

/** @typedef {import('./helpers.js').RawStatInitDescDefault<any> | import('./helpers.js').RawStatInitDescOptional<any>} RawStatInitDesc */

/**
 * @template T
 * @template {keyof T} K
 * @param {import('./helpers.js').RawStatInit<T, K>} init
 */
export const makeRawStats = (init) => {
  const initEntries = /** @type {[K, NonNullable<RawStatInitDesc>][]} */ (Object.entries(
    init,
  ).map(
    /** @param {[string, RawStatInitDesc]} entry */
    ([key, desc]) => [key, harden({ ...(desc || {}) })],
  ));
  const savedData = /** @type {import("./helpers.js").MakeRawStatsReturnType<T, K>['savedData']} */ ({});
  const publicProps = /** @type {import("./helpers.js").MakeRawStatsReturnType<T, K>['publicProps']} */ (makeGetterObject(
    initEntries.map(([key, desc]) => [
      key,
      () => (key in savedData ? savedData[key] : desc.default),
    ]),
  ));
  const privateSetters = /** @type {import("./helpers.js").MakeRawStatsReturnType<T, K>['privateSetters']} */ (harden(
    Object.fromEntries(
      initEntries.map(([key, desc]) => [
        key,
        /** @param {any} value */
        (value) => {
          if (!desc.writeMulti) {
            assert(!(key in savedData));
          }
          savedData[key] = value;
        },
      ]),
    ),
  ));
  return { savedData, publicProps, privateSetters };
};

/**
 * @template {string | number} K
 * @template {any} T
 * @returns {{
 *   collection: import("./types.js").StatsCollection<K, T>,
 *   insert: import("./helpers.js").CollectionInserter<K,T>,
 *   getCount: import("./helpers.js").CollectionCounter,
 * }}
 */
export const makeStatsCollection = () => {
  let count = 0;

  const getCount = () => count;

  const collection = Object.create(null);

  /**
   * @param {K} key
   * @param {T} value
   */
  const insert = (key, value) => {
    assert(!(key in collection));
    Object.defineProperty(collection, key, {
      value,
      enumerable: true,
    });
    count += 1;
  };

  return {
    collection,
    insert,
    getCount,
  };
};

/**
 * @template {{ [key: string]: () => any }} T
 * @param {T} getters
 * @returns {{
 *   readonly [P in keyof T]: ReturnType<T[P]>;
 * }}
 */
export const makeGetters = (getters) =>
  makeGetterObject(Object.entries(getters));

export const rounder = makeRounder(6);

/**
 * Note: hacky version of a deep clone
 * Limitation: It will remove undefined values
 *
 * @template T
 * @param {T} data
 * @returns {T}
 */
export const cloneData = (data) => JSON.parse(JSON.stringify(data));

/**
 *
 * @param {{}} target
 * @param  {any[]} sources
 * @returns {{}}
 */
export const copyProperties = (target, ...sources) =>
  Object.defineProperties(
    target,
    Object.assign(
      {},
      ...sources.map((source) => Object.getOwnPropertyDescriptors(source)),
    ),
  );
