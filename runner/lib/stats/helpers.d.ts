/* eslint-disable no-unused-vars,no-redeclare */

export type RawStatInitDescDefault<T> = {
  readonly default: T;
  readonly writeMulti?: boolean;
};
export type RawStatInitDescOptional<T> = null | {
  readonly default?: T;
  readonly writeMulti?: boolean;
};
export type RawStatInit<T, K extends keyof T> = {
  readonly [P in K]: [undefined] extends [T[P]]
    ? RawStatInitDescOptional<T[P]>
    : RawStatInitDescDefault<T[P]>;
};
export type SavedStatData<T, K extends keyof T> = {
  -readonly [P in K]?: T[P];
};
export type PublicStatProps<T, K extends keyof T> = {
  readonly [P in K]: T[P];
};
export type PrivateStatSetters<T, K extends keyof T> = {
  readonly [P in K]: (value: T[P]) => void;
};
export type MakeRawStatsReturnType<T, K extends keyof T> = {
  savedData: SavedStatData<T, K>;
  publicProps: PublicStatProps<T, K>;
  privateSetters: PrivateStatSetters<T, K>;
};

export interface CollectionInserter<K extends string | number, T> {
  (key: K, value: T): void;
}

export interface CollectionCounter {
  (): number;
}

export type MakeStatsCollectionReturnType<K extends string | number, T> = {
  collection: import('./types.js').StatsCollection<K, T>;
  insert: CollectionInserter<K, T>;
  getCount: CollectionCounter;
};

export declare function makeRawStats<T, K extends keyof T>(
  init: RawStatInit<T, K>,
): MakeRawStatsReturnType<T, K>;

export declare function makeStatsCollection<
  K extends string | number,
  T,
>(): MakeStatsCollectionReturnType<K, T>;

export declare function makeGetters<T extends { [key: string]: () => any }>(
  props: T,
): {
  readonly [P in keyof T]: ReturnType<T[P]>;
};

export declare const rounder: (value: number) => number;
export declare const percentageRounder: (value: number) => number;

export declare function cloneData<T>(data: T): T;

export declare function copyProperties<T, U>(target: T, source: U): T & U;
export declare function copyProperties<T, U, V>(
  target: T,
  source1: U,
  source2: V,
): T & U & V;
export declare function copyProperties<T, U, V, W>(
  target: T,
  source1: U,
  source2: V,
  source3: W,
): T & U & V & W;

export declare function arrayGroupBy<T, U extends PropertyKey>(
  source: ReadonlyArray<T>,
  callback: (value: T, index: number, array: ReadonlyArray<T>) => U,
): {
  [key in U]: T[];
};

type SumRecord<K extends string> = {
  readonly [P in K]: number;
};

export type Summary<K extends string> = {
  readonly values: number;
  readonly weights: number;
  readonly items: SumRecord<K>;
  readonly mins: SumRecord<K>;
  readonly maxes: SumRecord<K>;
  readonly totals: SumRecord<K>; // weighted
  readonly counts: SumRecord<K>; // weighted
  readonly averages: SumRecord<K>; // weighted
  readonly p95s: SumRecord<K>;
};

type SummaryRecord = { readonly [P in string]: number | undefined };
export type SummarizeData<T extends SummaryRecord> = ReadonlyArray<{
  values: T;
  weight?: number;
}>;

export declare function summarize<T extends SummaryRecord>(
  data: SummarizeData<T>,
): Summary<keyof T>;

export declare function notUndefined<T>(x: T | undefined): x is T;
