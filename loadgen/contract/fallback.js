// @ts-check

/**
 * @template T
 * @param {Promise<T>[]} args
 * @returns {Promise<T>}
 */
export const fallback = (...args) =>
  Promise.allSettled(args).then((results) => {
    for (const result of results) {
      if (result.status === 'fulfilled') {
        return result.value;
      }
    }
    assert.fail(
      assert.details`Failed to get value from any of the fallbacks (${
        /** @type {PromiseRejectedResult[]} */ (results).map(
          ({ reason }) => reason,
        )
      }.`,
    );
  });
