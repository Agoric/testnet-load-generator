// @ts-check

const { fromEntries, entries: toEntries } = Object;

/**
 * @template {PropertyKey} K
 * @template V
 * @param {Iterable<[ERef<K>, ERef<V>]>} entries
 */
export const allEntries = async (entries) =>
  Promise.all(Array.from(entries).map(async (entry) => Promise.all(entry)));

/**
 * @template T
 * @param {T} obj
 * @returns { Promise<{
 *   [P in keyof T]: Awaited<T[P]>
 * }> }
 */
export const allValues = async (obj) =>
  fromEntries(
    await allEntries(/** @type {[any, T[keyof T]][]} */ (toEntries(obj))),
  );
