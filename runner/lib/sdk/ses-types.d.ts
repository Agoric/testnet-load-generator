/* eslint-disable */

// This file is not referenced anywhere but it makes
// tsc happy for missing types in the source of dependencies

declare global {
  var LOCKDOWN_OPTIONS: string | void;
  var HandledPromise: HandledPromiseConstructor;
}

export {};
