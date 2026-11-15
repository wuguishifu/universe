import { z } from 'zod';

import { readFileSync } from 'node:fs';

import {
  EMA_VWAP_CROSSOVER,
  parseStrategyConfig,
  StrategyConfig,
} from '@projects/trading-core';

import { simulationConfigSchema } from './sim/simulation-config';

export const PRESETS = {
  'ema-vwap-crossover': EMA_VWAP_CROSSOVER,
} as const;
const PRESET_NAMES = ['ema-vwap-crossover'] as const satisfies ReadonlyArray<
  keyof typeof PRESETS
>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-11-16');

/**
 * A backtest run file. `strategy` is a full strategy config, or `{ "preset": "<name>" }` plus
 * any top-level fields to replace in that preset (each replaces the preset's field wholesale).
 */
export const runConfigSchema = z.object({
  name: z.string().min(1).default('backtest'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  strategy: z.looseObject({ preset: z.enum(PRESET_NAMES).optional() }),
  simulation: simulationConfigSchema.prefault({}),
});
export type RunConfig = z.infer<typeof runConfigSchema>;

export function resolveStrategy(
  strategy: RunConfig['strategy'],
): StrategyConfig {
  const { preset, ...overrides } = strategy;
  return parseStrategyConfig(
    preset ? { ...PRESETS[preset], ...overrides } : overrides,
  );
}

export function loadRunConfig(path: string): RunConfig {
  const result = runConfigSchema.safeParse(
    JSON.parse(readFileSync(path, 'utf8')),
  );
  if (!result.success) {
    throw new Error(
      `Invalid run config ${path}:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
