/* global Console */
/* eslint-disable no-unused-vars,no-redeclare */

export declare function sleep(ms: number, cancel?: Promise<any>): Promise<void>;

export interface AggregateError extends Error {
  readonly errors: Error[];
}

export declare function flattenAggregateErrors(errors: Error[]): Error[];

export declare function warnOnRejection(
  operation: Promise<any>,
  console: Console,
  ...messages: string[]
): void;

export declare function aggregateTryFinally<T>(
  trier: () => Promise<T>,
  finalizer: (error?: unknown) => Promise<void>,
): Promise<T>;

export declare function tryTimeout<T>(
  timeoutMs: number,
  trier: () => Promise<T>,
  onError?: () => Promise<void>,
): Promise<T>;

export declare function PromiseAllOrErrors<
  T1,
  T2,
  T3,
  T4,
  T5,
  T6,
  T7,
  T8,
  T9,
  T10,
>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
    T5 | PromiseLike<T5>,
    T6 | PromiseLike<T6>,
    T7 | PromiseLike<T7>,
    T8 | PromiseLike<T8>,
    T9 | PromiseLike<T9>,
    T10 | PromiseLike<T10>,
  ],
): Promise<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10]>;

export declare function PromiseAllOrErrors<T1, T2, T3, T4, T5, T6, T7, T8, T9>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
    T5 | PromiseLike<T5>,
    T6 | PromiseLike<T6>,
    T7 | PromiseLike<T7>,
    T8 | PromiseLike<T8>,
    T9 | PromiseLike<T9>,
  ],
): Promise<[T1, T2, T3, T4, T5, T6, T7, T8, T9]>;

export declare function PromiseAllOrErrors<T1, T2, T3, T4, T5, T6, T7, T8>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
    T5 | PromiseLike<T5>,
    T6 | PromiseLike<T6>,
    T7 | PromiseLike<T7>,
    T8 | PromiseLike<T8>,
  ],
): Promise<[T1, T2, T3, T4, T5, T6, T7, T8]>;

export declare function PromiseAllOrErrors<T1, T2, T3, T4, T5, T6, T7>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
    T5 | PromiseLike<T5>,
    T6 | PromiseLike<T6>,
    T7 | PromiseLike<T7>,
  ],
): Promise<[T1, T2, T3, T4, T5, T6, T7]>;

export declare function PromiseAllOrErrors<T1, T2, T3, T4, T5, T6>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
    T5 | PromiseLike<T5>,
    T6 | PromiseLike<T6>,
  ],
): Promise<[T1, T2, T3, T4, T5, T6]>;

export declare function PromiseAllOrErrors<T1, T2, T3, T4, T5>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
    T5 | PromiseLike<T5>,
  ],
): Promise<[T1, T2, T3, T4, T5]>;

export declare function PromiseAllOrErrors<T1, T2, T3, T4>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
    T4 | PromiseLike<T4>,
  ],
): Promise<[T1, T2, T3, T4]>;

export declare function PromiseAllOrErrors<T1, T2, T3>(
  values: readonly [
    T1 | PromiseLike<T1>,
    T2 | PromiseLike<T2>,
    T3 | PromiseLike<T3>,
  ],
): Promise<[T1, T2, T3]>;

export declare function PromiseAllOrErrors<T1, T2>(
  values: readonly [T1 | PromiseLike<T1>, T2 | PromiseLike<T2>],
): Promise<[T1, T2]>;

export declare function PromiseAllOrErrors<T>(
  values: readonly (T | PromiseLike<T>)[],
): Promise<T[]>;

export interface NextStep {
  (stop: Promise<void>): Promise<void>;
}

export interface Task {
  (nextStep: NextStep): Promise<void>;
}

export declare function sequential(...tasks: readonly Task[]): Task;

export declare function parallel(...tasks: readonly Task[]): Task;
