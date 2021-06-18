/* eslint-disable no-unused-vars,no-redeclare */

export type RunResult = {
  stop: () => void;
  done: Promise<void>;
  ready: Promise<void>;
};

export type RunChainInfo = {
  slogLines: AsyncIterable<string>;
  processInfo: import('./helpers/process-info.js').ProcessInfo;
  storageLocation: string;
};

export type RunChainResult = RunResult & RunChainInfo;

interface OperationBaseOption {
  readonly stdout: import('stream').Writable;
  readonly stderr: import('stream').Writable;
  readonly timeout?: number;
}

export interface TestOperations {
  resetChain(options: OperationBaseOption): Promise<void>;
  runChain(options: OperationBaseOption): Promise<RunChainResult>;
  runClient(options: OperationBaseOption): Promise<RunResult>;
  runLoadGen(options: OperationBaseOption): Promise<RunResult>;
}
