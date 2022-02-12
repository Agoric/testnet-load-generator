import type { TimeValueS } from '../helpers/time.js';

export interface LogPerfEvent {
  (eventType: string, data?: Record<string, unknown>): void;
}

export type StatsCollection<K extends number | string, T> = {
  readonly [P in K]?: T;
};

export interface BlockStatsInitData {
  readonly blockHeight: number;
  readonly blockTime: TimeValueS;
}

export interface BlockDeliveryData {
  readonly crankNum: number;
  readonly vatID: string;
  readonly deliveryNum: number;
  readonly computrons?: number | undefined;
}

export interface BlockStats extends BlockStatsInitData {
  recordStart(time: TimeValueS): void;
  recordEnd(time: TimeValueS): void;
  recordSwingsetStart(time: TimeValueS): void;
  recordSlogLine(): void;
  recordDelivery(data: BlockDeliveryData): void;
  readonly liveMode: boolean | undefined;
  readonly beginAt: TimeValueS | undefined;
  readonly endStartAt: TimeValueS | undefined;
  readonly endFinishAt: TimeValueS | undefined;
  readonly lag: number | undefined; // blockTime -> begin
  readonly blockDuration: number | undefined; // prev.endFinish -> endFinish
  readonly chainBlockDuration: number | undefined; // prev.blockTime -> blockTime
  readonly idleTime: number | undefined; // prev.endFinish -> begin
  readonly cosmosTime: number | undefined; // begin -> endStart
  readonly swingsetTime: number | undefined; // endStart -> endFinish
  readonly processingTime: number | undefined; // cosmosTime + swingsetTime
  readonly swingsetPercentage: number | undefined; // swingsetTime / blockDuration
  readonly processingPercentage: number | undefined; // processingTime / blockDuration
  readonly slogLines: number;
  readonly deliveries: number;
  readonly firstCrankNum: number | undefined;
  readonly lastCrankNum: number | undefined;
  readonly computrons: number;
}

export type BlockStatsSummary = {
  readonly liveMode: boolean | undefined;
  readonly startBlockHeight: number;
  readonly endBlockHeight: number;
  readonly blockCount: number;
  readonly avgLag: number;
  readonly avgBlockDuration: number;
  readonly avgChainBlockDuration: number;
  readonly avgIdleTime: number;
  readonly avgCosmosTime: number;
  readonly avgSwingsetTime: number;
  readonly avgProcessingTime: number;
  readonly avgSwingsetPercentage: number;
  readonly avgProcessingPercentage: number;
  readonly avgDeliveries: number;
  readonly avgComputrons: number;
  readonly p95Lag: number;
  readonly p95BlockDuration: number;
  readonly p95ChainBlockDuration: number;
  readonly p95IdleTime: number;
  readonly p95CosmosTime: number;
  readonly p95SwingsetTime: number;
  readonly p95ProcessingTime: number;
  readonly p95SwingsetPercentage: number;
  readonly p95ProcessingPercentage: number;
  readonly p95Deliveries: number;
  readonly p95Computrons: number;
};

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

export type CycleStatsSummary = {
  readonly cycleCount: number;
  readonly avgBlockCount: number;
  readonly avgDuration: number;
  readonly p95BlockCount: number | undefined;
  readonly p95Duration: number | undefined;
  readonly cycleSuccessRate: number;
};

export interface StageStatsInitData {
  readonly stageConfig: Readonly<Record<string, unknown>>;
  readonly stageIndex: number;
  readonly previousCycleCount: number;
}

export type StageBlocksSummaryType =
  | 'all'
  | 'onlyLive'
  | 'onlyCatchup'
  | 'last100';

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
  readonly blocksSummaries:
    | StatsCollection<StageBlocksSummaryType, BlockStatsSummary | undefined>
    | undefined;
  readonly cyclesSummaries:
    | StatsCollection<'all' | string, CycleStatsSummary | undefined>
    | undefined;
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
  newStage(data: Omit<StageStatsInitData, 'previousCycleCount'>): StageStats;
  recordWalletDeployStart(time: TimeValueS): void;
  recordWalletDeployEnd(time: TimeValueS): void;
  recordLoadgenDeployStart(time: TimeValueS): void;
  recordLoadgenDeployEnd(time: TimeValueS): void;
  readonly stages: StatsCollection<number, StageStats>;
  readonly stageCount: number;
  readonly totalBlockCount: number;
  readonly liveBlocksSummary: BlockStatsSummary | undefined;
  readonly cyclesSummary: CycleStatsSummary | undefined;
  readonly startedAt: TimeValueS | undefined;
  readonly endedAt: TimeValueS | undefined;
  readonly duration: number | undefined;
  readonly chainBootstrapStartedAt: TimeValueS | undefined;
  readonly chainBootstrapEndedAt: TimeValueS | undefined;
  readonly chainBootstrapDuration: number | undefined;
  readonly walletDeployStartedAt: TimeValueS | undefined;
  readonly walletDeployEndedAt: TimeValueS | undefined;
  readonly walletDeployDuration: number | undefined;
  readonly loadgenDeployStartedAt: TimeValueS | undefined;
  readonly loadgenDeployEndedAt: TimeValueS | undefined;
  readonly loadgenDeployDuration: number | undefined;
}
