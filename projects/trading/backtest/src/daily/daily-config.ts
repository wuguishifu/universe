import { z } from 'zod';

import { readFileSync } from 'node:fs';

import {
  AllocationConfig,
  allocationRuleSchema,
  allocationTickers,
} from '@projects/trading-core';

import { isoDateSchema } from '../run-config';

/** Several allocation rules, run side by side over the same dates and costs. */
export const dailySuiteSchema = z.object({
  name: z.string().min(1),
  from: isoDateSchema,
  to: isoDateSchema,
  startingCash: z.number().positive().default(100_000),
  costBps: z.number().nonnegative().default(5),
  /** Where unallocated money sits, e.g. BIL. */
  cash: z.string().min(1),
  strategies: z
    .record(z.string(), allocationRuleSchema)
    .refine((s) => Object.keys(s).length > 0, 'add at least one strategy'),
});
export type DailySuite = z.infer<typeof dailySuiteSchema>;

export const suiteAllocations = (
  suite: DailySuite,
): Array<[string, AllocationConfig]> =>
  Object.entries(suite.strategies).map(([label, rule]) => [
    label,
    { cash: suite.cash, rule },
  ]);

export const suiteTickers = (suite: DailySuite): string[] => [
  ...new Set(
    suiteAllocations(suite).flatMap(([, config]) => allocationTickers(config)),
  ),
];

export const loadDailySuite = (path: string): DailySuite =>
  dailySuiteSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
