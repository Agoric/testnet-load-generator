/* eslint-disable no-unused-vars,no-redeclare */

export type RunResult = {
  readonly stop: () => void;
  readonly done: Promise<void>;
  readonly ready: Promise<void>;
};

export type RunChainInfo = {
  readonly slogLines: AsyncIterable<string>;
  readonly processInfo: import('./helpers/process-info.js').ProcessInfo;
  readonly storageLocation: string;
};

export type RunChainResult = RunResult & RunChainInfo;

interface OperationBaseOption {
  readonly stdout: import('stream').Writable;
  readonly stderr: import('stream').Writable;
  readonly timeout?: number;
  readonly config?: unknown;
}

export interface TestOperations {
  setupTest(options: OperationBaseOption): Promise<void>;
  runChain(options: OperationBaseOption): Promise<RunChainResult>;
  runClient(options: OperationBaseOption): Promise<RunResult>;
  runLoadgen(options: OperationBaseOption): Promise<RunResult>;
}
