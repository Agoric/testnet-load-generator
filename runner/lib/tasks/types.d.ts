/* global Buffer */
/* eslint-disable no-unused-vars,no-redeclare */

import type { TimeValueS } from '../helpers/time.js';

export interface EnvInfo {
  readonly agChainCosmosVersion?: unknown;
}

export interface SDKBinaries {
  readonly agSolo: string;
  readonly cosmosChain: string;
  readonly cosmosHelper: string;
}

export type TaskResult = {
  readonly stop: () => void;
  readonly done: Promise<void>;
  readonly ready: Promise<void>;
};

export type RunChainInfo = {
  readonly slogLines: AsyncIterable<Buffer>;
  readonly processInfo: import('../helpers/process-info.js').ProcessInfo;
  readonly storageLocation: string;
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
};

export type RunChainResult = TaskResult & RunChainInfo;
export type RunLoadgenResult = TaskResult & RunLoadgenInfo;

export interface TaskBaseOptions {
  readonly stdout: import('stream').Writable;
  readonly stderr: import('stream').Writable;
  readonly timeout?: number;
  readonly config?: unknown;
}

export interface OrchestratorTasks {
  getEnvInfo(options: TaskBaseOptions): Promise<EnvInfo>;
  setupTasks(options: TaskBaseOptions): Promise<void>;
  runChain(options: TaskBaseOptions): Promise<RunChainResult>;
  runClient(options: TaskBaseOptions): Promise<TaskResult>;
  runLoadgen(options: TaskBaseOptions): Promise<RunLoadgenResult>;
}
