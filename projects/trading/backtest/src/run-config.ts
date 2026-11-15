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

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-11-16');

/**
 * A backtest run file. `strategy` is a full strategy config, or `{ "preset": "<name>" }` plus
 * any top-level fields to replace in that preset (each replaces the preset's field wholesale).
 */
export const strategySourceSchema = z.looseObject({
  preset: z.enum(PRESET_NAMES).optional(),
});
export type StrategySource = z.infer<typeof strategySourceSchema>;

export const runConfigSchema = z.object({
  name: z.string().min(1).default('backtest'),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  strategy: strategySourceSchema,
  simulation: simulationConfigSchema.prefault({}),
});
export type RunConfig = z.infer<typeof runConfigSchema>;

/** The preset with the overrides laid over it, before validation. */
export function strategyInput({
  preset,
  ...overrides
}: StrategySource): Record<string, unknown> {
  return preset ? { ...PRESETS[preset], ...overrides } : overrides;
}

export function resolveStrategy(strategy: StrategySource): StrategyConfig {
  return parseStrategyConfig(strategyInput(strategy));
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
