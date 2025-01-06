#! /usr/bin/env node
/* global process console */

import '@endo/init';

import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import main from './main.js';
// @TODO: separate helpers in a standalone folder
import {
  flattenAggregateErrors,
  aggregateTryFinally,
} from '../../runner/lib/helpers/async.js';

const start = async () => {
  const progname = basename(process.argv[1]);
  const { mkdtemp, rm, rmdir } = fs;

  const tmpDir = await mkdtemp(
    join(tmpdir(), `${progname.replace(/[^a-z0-9_]/gi, '-')}-`),
  );

  return aggregateTryFinally(
    () =>
      main(progname, process.argv.slice(2), {
        fs,
        fsStream: {
          createReadStream,
          createWriteStream,
        },
        spawn,
        stderr: process.stderr,
        stdout: process.stdout,
        tmpDir,
      }),
    async () => (rm || rmdir)(tmpDir, { recursive: true }),
  );
};

start().then(
  (res) => res === undefined || process.exit(res),
  (rej) => {
    console.error(rej);
    if (rej.errors)
      flattenAggregateErrors(rej.errors).forEach((error) =>
        console.error('nested error:', error),
      );
    process.exit(2);
  },
);

process.on('uncaughtException', (error) => {
  console.error('uncaught exception', error);
  process.exit(2);
});
