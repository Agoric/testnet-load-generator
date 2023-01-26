#!/usr/bin/env node
/* global process */

import '@endo/init';

import { promisify } from 'util';
import { pipeline as pipelineCallback } from 'stream';
import BufferLineTransform from '../lib/helpers/buffer-line-transform.js';
import { getBlocksSummaries, getCyclesSummaries } from '../lib/stats/stages.js';
import {
  getLiveBlocksSummary,
  getCyclesSummary,
  getTotalBlockCount,
} from '../lib/stats/run.js';

const pipeline = promisify(pipelineCallback);

const { stdout, stdin } = process;

async function* linesToEvent(lines) {
  for await (const line of lines) {
    yield JSON.parse(line.toString('utf8'));
  }
}

async function* processEvent(events) {
  for await (const event of events) {
    if (event.type === 'perf-finish') {
      /** @type {import('../lib/stats/types').RunStats} */
      const stats = event.stats;

      const stages = Object.fromEntries(
        Object.entries(stats.stages).map(([idx, stage]) => {
          const { blocks, cycles, endedAt } = stage;

          // Currently if the stage fails, no summary is generated
          if (endedAt === undefined) {
            return [idx, stage];
          }

          const blockValues = Object.values(blocks);
          const cycleValues = Object.values(cycles);

          const blocksSummaries = blockValues.length
            ? getBlocksSummaries(blockValues)
            : undefined;
          const cyclesSummaries = cycleValues.length
            ? getCyclesSummaries(cycleValues)
            : undefined;

          return [idx, { ...stage, blocksSummaries, cyclesSummaries }];
        }),
      );

      const cyclesSummary = getCyclesSummary(stages);
      const liveBlocksSummary = getLiveBlocksSummary(stages);
      const totalBlockCount = getTotalBlockCount(stages);

      yield {
        ...event,
        stats: {
          ...stats,
          stages,
          cyclesSummary,
          liveBlocksSummary,
          totalBlockCount,
        },
      };
    } else {
      yield event;
    }
  }
}

async function* eventToLine(events) {
  for await (const event of events) {
    yield `${JSON.stringify(event)}\n`;
  }
}

await pipeline(
  stdin,
  new BufferLineTransform(),
  linesToEvent,
  processEvent,
  eventToLine,
  stdout,
);
