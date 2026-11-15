import { z } from 'zod';

import { Breakout, breakoutConfigSchema } from './breakout';
import { Crossover, crossoverConfigSchema } from './crossover';
import { SignalGenerator } from './signal';
import { TimedMomentum, timedMomentumConfigSchema } from './timed-momentum';

export const signalConfigSchema = z.discriminatedUnion('type', [
  crossoverConfigSchema,
  breakoutConfigSchema,
  timedMomentumConfigSchema,
]);
export type SignalConfig = z.infer<typeof signalConfigSchema>;

export function createSignal(config: SignalConfig): SignalGenerator {
  switch (config.type) {
    case 'crossover':
      return new Crossover(config);
    case 'breakout':
      return new Breakout(config);
    case 'timedMomentum':
      return new TimedMomentum(config);
  }
}

/** Indicator names the signal reads, so the config can check they exist. */
export function signalIndicators(config: SignalConfig): string[] {
  switch (config.type) {
    case 'crossover':
      return [config.fast, config.slow];
    case 'breakout':
      return [config.upper, config.lower];
    case 'timedMomentum':
      return [];
  }
}
