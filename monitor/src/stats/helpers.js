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
  const initEntries = /** @type {[K, NonNullable<RawStatInitDesc>][]} */ (
    Object.entries(init).map(
      /** @param {[string, RawStatInitDesc]} entry */
      ([key, desc]) => [key, harden({ ...(desc || {}) })],
    )
  );
  const savedData =
    /** @type {import("./helpers.js").MakeRawStatsReturnType<T, K>['savedData']} */ ({});
  const publicProps =
    /** @type {import("./helpers.js").MakeRawStatsReturnType<T, K>['publicProps']} */ (
      makeGetterObject(
        initEntries.map(([key, desc]) => [
          key,
          () => (key in savedData ? savedData[key] : desc.default),
        ]),
      )
    );
  const privateSetters =
    /** @type {import("./helpers.js").MakeRawStatsReturnType<T, K>['privateSetters']} */ (
      harden(
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
      )
    );
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

/** @param {unknown} val */
export const notUndefined = (val) => val !== undefined;

/**
 * @param {Array<{values: Record<string, number | undefined>, weight?: number | undefined}>} data
 * @returns {import('./helpers.js').Summary<string>}
 */
export const summarize = (data) => {
  const keys = new Set(data.flatMap(({ values }) => Object.keys(values)));

  const weights = data.reduce((acc, { weight = 1 }) => acc + weight, 0);

  const items = /** @type {Record<string, number>} */ ({});
  const mins = /** @type {Record<string, number>} */ ({});
  const maxes = /** @type {Record<string, number>} */ ({});
  const totals = /** @type {Record<string, number>} */ ({});
  const counts = /** @type {Record<string, number>} */ ({});
  const averages = /** @type {Record<string, number>} */ ({});
  const p95s = /** @type {Record<string, number>} */ ({});

  for (const key of keys) {
    const sortedData =
      /** @type {Array<{values: Record<string, number>, weight?: number | undefined}>} */ (
        data.filter(({ values }) => Number.isFinite(values[key]))
      ).sort((a, b) => a.values[key] - b.values[key]);

    items[key] = sortedData.length;
    mins[key] = sortedData.length ? sortedData[0].values[key] : NaN;
    maxes[key] = sortedData.length ? sortedData.slice(-1)[0].values[key] : NaN;
    totals[key] = 0;
    counts[key] = 0;
    for (const { values, weight = 1 } of sortedData) {
      totals[key] += values[key] * weight;
      counts[key] += weight;
    }
    averages[key] = totals[key] / counts[key];

    if (
      sortedData.length > 1 &&
      sortedData.every(({ weight = 1 }) => weight === 1)
    ) {
      const rank = (95 * (sortedData.length - 1)) / 100;
      const rankIndex = Math.floor(rank);
      const basePercentile = sortedData[rankIndex].values[key];
      const nextPercentile = sortedData[rankIndex + 1].values[key];
      p95s[key] =
        basePercentile +
        (rankIndex - rankIndex) * (nextPercentile - basePercentile);
    } else {
      p95s[key] = NaN;
    }
  }

  return harden({
    values: data.values.length,
    weights,
    items,
    mins,
    maxes,
    totals,
    counts,
    averages,
    p95s,
  });
};
