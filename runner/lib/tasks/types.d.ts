/* global Buffer */
/* eslint-disable no-unused-vars,no-redeclare */

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

export type RunLoadgenInfo = {
  readonly taskEvents: AsyncIterable<Record<string, unknown>>;
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
  setupTasks(options: TaskBaseOptions): Promise<void>;
  runChain(options: TaskBaseOptions): Promise<RunChainResult>;
  runClient(options: TaskBaseOptions): Promise<TaskResult>;
  runLoadgen(options: TaskBaseOptions): Promise<RunLoadgenResult>;
}
