/* global Buffer */

import type { TimeValueS } from '../helpers/time.js';

export interface EnvInfo {
  readonly agChainCosmosVersion?: unknown;
}

export interface SDKBinaries {
  readonly agSolo: string;
  readonly cosmosChain: string;
  readonly cosmosHelper: string;
}

export type SetupTasksResult = {
  readonly chainStorageLocation?: string;
  readonly clientStorageLocation?: string;
};

export type TaskResult = {
  readonly stop: () => void;
  readonly done: Promise<void>;
  readonly ready: Promise<void>;
};

export type RunKernelInfo = {
  readonly slogLines: AsyncIterable<Buffer>;
  readonly processInfo: import('../helpers/process-info.js').ProcessInfo;
};

export type TaskEventStatus = Record<string, unknown> & {
  time: TimeValueS;
  type: 'status';
};

export type TaskEventStart = {
  time: TimeValueS;
  type: 'start';
  task: string;
  seq: number;
};

export type TaskEventFinish = {
  time: TimeValueS;
  type: 'finish';
  task: string;
  seq: number;
  success: boolean;
};

export type TaskEvent = TaskEventStatus | TaskEventStart | TaskEventFinish;

export type RunLoadgenInfo = {
  readonly taskEvents: AsyncIterable<TaskEvent>;
  updateConfig(newConfig: unknown): Promise<void>;
};

export type RunChainResult = TaskResult & RunKernelInfo;
export type RunClientResult = TaskResult & RunKernelInfo;
export type RunLoadgenResult = TaskResult & RunLoadgenInfo;

export interface TaskBaseOptions {
  readonly stdout: import('stream').Writable;
  readonly stderr: import('stream').Writable;
  readonly timeout?: number;
  readonly orInterrupt?: (job?: Promise<any>) => Promise<any>;
  readonly config?: unknown;
}

export interface OrchestratorTasks {
  getEnvInfo(options: TaskBaseOptions): Promise<EnvInfo>;
  setupTasks(options: TaskBaseOptions): Promise<SetupTasksResult>;
  runChain(options: TaskBaseOptions): Promise<RunChainResult>;
  runClient(options: TaskBaseOptions): Promise<RunClientResult>;
  runLoadgen(options: TaskBaseOptions): Promise<RunLoadgenResult>;
}
