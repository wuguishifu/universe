import { z } from 'zod';

import { Crossover, crossoverConfigSchema } from './crossover';
import { SignalGenerator } from './signal';

export const signalConfigSchema = z.discriminatedUnion('type', [
  crossoverConfigSchema,
]);
export type SignalConfig = z.infer<typeof signalConfigSchema>;

export function createSignal(config: SignalConfig): SignalGenerator {
  switch (config.type) {
    case 'crossover':
      return new Crossover(config);
  }
}

/** Indicator names the signal reads, so the config can check they exist. */
export function signalIndicators(config: SignalConfig): string[] {
  switch (config.type) {
    case 'crossover':
      return [config.fast, config.slow];
  }
}
