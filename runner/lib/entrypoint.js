#!/usr/bin/env node
/* global process */
// @ts-nocheck

import '@agoric/install-ses';

import path from 'path';
import { spawn } from 'child_process';
import rawFs from 'fs';
import os from 'os';

import main from './main.js';
import {
  flattenAggregateErrors,
  aggregateTryFinally,
} from './helpers/async.js';

const fs = rawFs.promises;
const fsStream = {
  createReadStream: rawFs.createReadStream,
  createWriteStream: rawFs.createWriteStream,
};
const progname = path.basename(process.argv[1]);

const { stdout, stderr } = process;

const rawArgs = process.argv.slice(2);

process.on('uncaughtException', (error) => {
  console.error('uncaught exception', error);
  process.exit(2);
});

(async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `${progname.replace(/[^a-z0-9_]/gi, '-')}-`),
  );

  return aggregateTryFinally(
    async () =>
      main(progname, rawArgs, {
        stdout,
        stderr,
        fs,
        fsStream,
        os,
        process,
        spawn,
        tmpDir,
      }),
    async () => fs.rmdir(tmpDir, { recursive: true }),
  );
})().then(
  (res) => {
    res === undefined || process.exit(res);
  },
  (rej) => {
    // console.log(process._getActiveRequests(), process._getActiveHandles());
    console.error(rej);
    if (rej.errors) {
      flattenAggregateErrors(rej.errors).forEach((error) =>
        console.error('nested error:', error),
      );
    }
    process.exit(2);
  },
);
