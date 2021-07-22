/* global setTimeout */

import { makePromiseKit } from '@agoric/promise-kit';

/** @type {import("./async.js").sleep} */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Error[]} errors
 * @param {string} [message]
 */
const makeAggregateError = (errors, message) => {
  const err = new Error(message);
  Object.defineProperties(err, {
    name: {
      value: 'AggregateError',
    },
    errors: {
      value: errors,
    },
  });
  return err;
};

/**
 * @template T
 * @param {readonly (T | PromiseLike<T>)[]} values
 * @returns {Promise<T[]>}
 */
export const PromiseAllOrErrors = async (values) => {
  return Promise.allSettled(values).then((results) => {
    const errors = /** @type {PromiseRejectedResult[]} */ (results.filter(
      ({ status }) => status === 'rejected',
    )).map((result) => result.reason);
    if (!errors.length) {
      return /** @type {PromiseFulfilledResult<T>[]} */ (results).map(
        (result) => result.value,
      );
    } else if (errors.length === 1) {
      throw errors[0];
    } else {
      throw makeAggregateError(errors);
    }
  });
};

/** @type {import("./async.js").flattenAggregateErrors} */
export const flattenAggregateErrors = (errors) =>
  errors.reduce((arr, error) => {
    arr.push(error);
    if ('errors' in error) {
      arr.push(
        ...flattenAggregateErrors(/** @type {AggregateError} */ (error).errors),
      );
    }
    return arr;
  }, /** @type {Error[]} */ ([]));

/** @type {import("./async.js").warnOnRejection} */
export const warnOnRejection = (operation, console, ...messages) => {
  operation.catch((error) => {
    console.warn(...messages, error);
    if ('errors' in error) {
      // TODO: Plug into SES error handling
      console.warn(
        'Reasons:',
        ...flattenAggregateErrors(/** @type {AggregateError} */ (error).errors),
      );
    }
  });
};

/** @type {import("./async.js").aggregateTryFinally} */
export const aggregateTryFinally = async (trier, finalizer) =>
  trier().then(
    async (result) => finalizer().then(() => result),
    async (tryError) =>
      finalizer()
        .then(
          () => tryError,
          (finalizeError) => makeAggregateError([tryError, finalizeError]),
        )
        .then((error) => Promise.reject(error)),
  );

/** @type {import("./async.js").tryTimeout} */
export const tryTimeout = async (timeoutMs, trier, onError) => {
  const result = Promise.race([
    sleep(timeoutMs).then(() => Promise.reject(new Error('Timeout'))),
    trier(),
  ]);

  return !onError
    ? result
    : result.catch(async (error) =>
        onError()
          .then(
            () => error,
            (cleanupError) => makeAggregateError([error, cleanupError]),
          )
          .then((finalError) => Promise.reject(finalError)),
      );
};

/** @typedef {import("./async.js").Task} Task */
/**
 * @template T
 * @typedef {import('@agoric/promise-kit').PromiseRecord<T>} PromiseRecord<T>
 */

/**
 * @param {Task[]} tasks
 * @returns {Task}
 */
export const sequential = (...tasks) => {
  return tasks.reduceRight((accumulatedTask, prevTask) => async (nextStep) => {
    await prevTask(async (stopPrev) => {
      await accumulatedTask(async (stopAcc) => {
        await nextStep(Promise.race([stopAcc, stopPrev]));
      });
    });
  });
};

/**
 * @param {Task[]} tasks
 * @returns {Task}
 */
export const parallel = (...tasks) => async (nextStep) => {
  /** @type {PromiseRecord<{stop: Promise<void>}>[]} */
  const kits = tasks.map(() => makePromiseKit());
  /** @type {PromiseRecord<void>} */
  const nextStepDone = makePromiseKit();
  Promise.all(kits.map((kit) => kit.promise)).then((wrappedStops) => {
    nextStepDone.resolve(
      nextStep(Promise.race(wrappedStops.map(({ stop }) => stop))),
    );
  });
  await Promise.all(
    tasks.map((task, i) =>
      task((stop) => {
        kits[i].resolve({ stop });
        return nextStepDone.promise;
      }),
    ),
  );
};
