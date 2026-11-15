import { z } from 'zod';

import { readFileSync } from 'node:fs';

import { parseStrategyConfig, StrategyConfig } from '@projects/trading-core';

import {
  isoDateSchema,
  strategyInput,
  strategySourceSchema,
} from '../run-config';
import { simulationConfigSchema } from '../sim/simulation-config';

const rangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema });

/**
 * A grid of strategy variants. Each axis maps a label to a patch over `base`; every combination
 * of one label per axis is one config. Patches merge into objects, and their `exits`,
 * `entryFilters` and `risk` are appended to the base's, so axes can each add their own rules.
 */
export const sweepConfigSchema = z.object({
  name: z.string().min(1).default('sweep'),
  /** Configs are ranked on this range. */
  train: rangeSchema,
  /** The top configs are re-run here, on days the ranking never saw. */
  test: rangeSchema.optional(),
  simulation: simulationConfigSchema.prefault({}),
  base: strategySourceSchema,
  axes: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())))
    .refine(
      (axes) =>
        Object.values(axes).every((values) => Object.keys(values).length > 0),
      {
        message: 'every axis needs at least one value',
      },
    ),
  rankBy: z
    .enum(['netPnl', 'profitFactor', 'expectancy', 'tStat'])
    .default('netPnl'),
  /** Configs with fewer training trades than this aren't ranked. */
  minTrades: z.number().int().nonnegative().default(30),
  top: z.number().int().positive().default(10),
  /**
   * Each range is cut into chunks of about this many trading days, each backtested on its own
   * (after the usual warmup) and pinned to one worker, so no worker holds all the data.
   */
  chunkDays: z.number().int().positive().default(20),
});
export type SweepConfig = z.infer<typeof sweepConfigSchema>;

export function loadSweepConfig(path: string): SweepConfig {
  const result = sweepConfigSchema.safeParse(
    JSON.parse(readFileSync(path, 'utf8')),
  );
  if (!result.success) {
    throw new Error(
      `Invalid sweep config ${path}:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export type Combo = {
  id: number;
  /** The label picked on each axis. */
  choices: Record<string, string>;
  strategy: StrategyConfig;
};

const APPENDED = new Set(['exits', 'entryFilters', 'risk']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function applyPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  topLevel = true,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (
      topLevel &&
      APPENDED.has(key) &&
      Array.isArray(current) &&
      Array.isArray(value)
    ) {
      merged[key] = [...current, ...value];
    } else if (isRecord(current) && isRecord(value)) {
      merged[key] = applyPatch(current, value, false);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** Every combination of the axes. Combinations that fail validation are reported, not thrown. */
export function expandCombos(config: SweepConfig): {
  combos: Combo[];
  invalid: string[];
} {
  const axes = Object.entries(config.axes);
  let partials: Array<{
    choices: Record<string, string>;
    input: Record<string, unknown>;
  }> = [{ choices: {}, input: strategyInput(config.base) }];
  for (const [axis, values] of axes) {
    partials = partials.flatMap(({ choices, input }) =>
      Object.entries(values).map(([label, patch]) => ({
        choices: { ...choices, [axis]: label },
        input: applyPatch(input, patch),
      })),
    );
  }

  const combos: Combo[] = [];
  const invalid: string[] = [];
  for (const { choices, input } of partials) {
    try {
      combos.push({
        id: combos.length,
        choices,
        strategy: parseStrategyConfig(input),
      });
    } catch (error) {
      invalid.push(
        `${describeChoices(choices)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { combos, invalid };
}

export const describeChoices = (choices: Record<string, string>): string =>
  Object.entries(choices)
    .map(([axis, label]) => `${axis}=${label}`)
    .join(' ');
