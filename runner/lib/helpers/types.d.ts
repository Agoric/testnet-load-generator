/* global Buffer */
/* eslint-disable no-unused-vars,no-redeclare */

import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';

export type ChildProcessWithStreamOutput = ChildProcessByStdio<
  any,
  Readable,
  any
>;

export interface ChildProcessOutput {
  <T>(
    childProcess: ChildProcessWithStreamOutput,
    outHandler: (out: Readable) => Promise<T>,
  ): Promise<T>;
  (childProcess: ChildProcessWithStreamOutput): Promise<Buffer>;
}
