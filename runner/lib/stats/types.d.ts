/* eslint-disable no-unused-vars,no-redeclare */

export interface LogPerfEvent {
  (eventType: string, data?: Record<string, unknown>): void;
}

export type StatsCollection<K extends number | string, T> = {
  readonly [P in K]?: T;
};

export interface BlockStatsInitData {
  readonly blockHeight: number;
}

export interface BlockStats extends BlockStatsInitData {
  recordStart(): void;
  recordEnd(): void;
  recordSwingsetStart(): void;
  recordSlogLine(): void;
  readonly slogLines: number;
}

export interface StageStatsInitData {
  readonly stageConfig: Readonly<Record<string, unknown>>;
  readonly stageIndex: number;
}

export interface StageStats extends StageStatsInitData {
  recordStart(): void;
  recordEnd(): void;
  newBlock(data: BlockStatsInitData): BlockStats;
  readonly blocks: StatsCollection<number, BlockStats>;
  readonly blockCount: number;
  readonly firstBlockHeight: number | undefined;
  readonly lastBlockHeight: number | undefined;
}

export interface RunStatsInitData {}

export interface RunStats extends RunStatsInitData {
  recordStart(): void;
  recordEnd(): void;
  newStage(data: StageStatsInitData): StageStats;
  readonly stages: StatsCollection<number, StageStats>;
  readonly stageCount: number;
  readonly blockCount: number;
}
