/* eslint-disable no-unused-vars,no-redeclare */

import type { TimeValueS } from '../helpers/time.js';

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
  readonly liveMode: boolean | undefined;
}

export interface CycleStatsInitData {
  readonly task: string;
  readonly seq: number;
}

export type CycleStatsCollectionKey = `${string}/${number}`;

export interface CycleStats extends CycleStatsInitData {
  recordStart(time: TimeValueS): void;
  recordEnd(time: TimeValueS, success: boolean): void;
  readonly success: boolean | undefined;
  readonly startBlockHeight: number | undefined;
  readonly endBlockHeight: number | undefined;
  readonly blockCount: number | undefined;
  readonly startedAt: TimeValueS | undefined;
  readonly endedAt: TimeValueS | undefined;
  readonly duration: number | undefined;
}

export interface StageStatsInitData {
  readonly stageConfig: Readonly<Record<string, unknown>>;
  readonly stageIndex: number;
}

export interface StageStats extends StageStatsInitData {
  recordStart(time: TimeValueS): void;
  recordReady(time: TimeValueS): void;
  recordEnd(time: TimeValueS): void;
  recordChainStart(time: TimeValueS): void;
  recordChainReady(time: TimeValueS): void;
  recordClientStart(time: TimeValueS): void;
  recordClientReady(time: TimeValueS): void;
  recordLoadgenStart(time: TimeValueS): void;
  recordLoadgenReady(time: TimeValueS): void;
  newBlock(data: BlockStatsInitData): BlockStats;
  getOrMakeCycle(data: CycleStatsInitData): CycleStats;
  readonly blocks: StatsCollection<number, BlockStats>;
  readonly blockCount: number;
  readonly cycles: StatsCollection<CycleStatsCollectionKey, CycleStats>;
  readonly cycleCount: number;
  readonly firstBlockHeight: number | undefined;
  readonly lastBlockHeight: number | undefined;
  readonly startedAt: TimeValueS | undefined;
  readonly readyAt: TimeValueS | undefined;
  readonly endedAt: TimeValueS | undefined;
  readonly readyDuration: number | undefined;
  readonly duration: number | undefined;
  readonly chainStartedAt: TimeValueS | undefined;
  readonly chainReadyAt: TimeValueS | undefined;
  readonly chainInitDuration: number | undefined;
  readonly clientStartedAt: TimeValueS | undefined;
  readonly clientReadyAt: TimeValueS | undefined;
  readonly clientInitDuration: number | undefined;
  readonly loadgenStartedAt: TimeValueS | undefined;
  readonly loadgenReadyAt: TimeValueS | undefined;
  readonly loadgenInitDuration: number | undefined;
}

export interface RunMetadata {
  readonly profile: string;
  readonly testnetOrigin?: string;
  readonly agChainCosmosVersion?: unknown;
  readonly testData?: unknown;
}

export interface RunStatsInitData {
  readonly metadata: RunMetadata;
}

export interface RunStats extends RunStatsInitData {
  recordStart(time: TimeValueS): void;
  recordEnd(time: TimeValueS): void;
  newStage(data: StageStatsInitData): StageStats;
  recordWalletDeployStart(time: TimeValueS): void;
  recordWalletDeployEnd(time: TimeValueS): void;
  recordLoadgenDeployStart(time: TimeValueS): void;
  recordLoadgenDeployEnd(time: TimeValueS): void;
  readonly stages: StatsCollection<number, StageStats>;
  readonly stageCount: number;
  readonly blockCount: number;
  readonly cycleCount: number;
  readonly startedAt: TimeValueS | undefined;
  readonly endedAt: TimeValueS | undefined;
  readonly duration: number | undefined;
  readonly walletDeployStartedAt: TimeValueS | undefined;
  readonly walletDeployEndedAt: TimeValueS | undefined;
  readonly walletDeployDuration: number | undefined;
  readonly loadgenDeployStartedAt: TimeValueS | undefined;
  readonly loadgenDeployEndedAt: TimeValueS | undefined;
  readonly loadgenDeployDuration: number | undefined;
}
