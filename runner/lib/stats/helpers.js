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
export const percentageRounder = makeRounder(2, -2);

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

/**
 *
 * @param {ReadonlyArray<unknown>} source
 * @param {(value: unknown, index: number, array: ReadonlyArray<unknown>) => PropertyKey} callback
 */
export const arrayGroupBy = (source, callback) => {
  /** @type {{[key: PropertyKey]: unknown[]}} */
  const target = Object.create(null);
  source.forEach((value, index) => {
    const key = Reflect.ownKeys({ [callback(value, index, source)]: null })[0];
    if (key in target) {
      target[key].push(value);
    } else {
      target[key] = [value];
    }
  });

  return target;
};

export const makeSummer = () => {
  /** @type {Map<string, {min: number, max: number, values: number, weights: number, total: number}>} */
  const sumDatas = new Map();
  let weights = 0;
  let values = 0;

  /**
   *
   * @param {Record<string, number | undefined>} obj
   * @param {number} [weight]
   */
  const add = (obj, weight = 1) => {
    values += 1;
    weights += weight;
    for (const [key, value] of Object.entries(obj)) {
      let sumData = sumDatas.get(key);
      if (!sumData) {
        sumData = {
          min: NaN,
          max: NaN,
          values: 0,
          weights: 0,
          total: 0,
        };
        sumDatas.set(key, sumData);
      }
      if (value != null && !Number.isNaN(value)) {
        sumData.values += 1;
        sumData.weights += weight;
        sumData.total += value * weight;
        if (!(value > sumData.min)) {
          sumData.min = value;
        }
        if (!(value < sumData.max)) {
          sumData.max = value;
        }
      }
    }
  };

  const getSums = () => {
    const items = /** @type {Record<string, number>} */ ({});
    const mins = /** @type {Record<string, number>} */ ({});
    const maxes = /** @type {Record<string, number>} */ ({});
    const totals = /** @type {Record<string, number>} */ ({});
    const counts = /** @type {Record<string, number>} */ ({});
    const averages = /** @type {Record<string, number>} */ ({});

    for (const [key, sumData] of sumDatas.entries()) {
      items[key] = sumData.values;
      mins[key] = sumData.min;
      maxes[key] = sumData.max;
      totals[key] = sumData.total;
      counts[key] = sumData.weights;
      averages[key] = sumData.total / sumData.weights;
    }

    return harden({
      values,
      weights,
      items,
      mins,
      maxes,
      totals,
      counts,
      averages,
    });
  };

  return harden({ add, getSums });
};
