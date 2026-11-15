import { z } from 'zod';

import { ExitRule } from './exit-rule';
import {
  FlatBeforeClose,
  flatBeforeCloseConfigSchema,
  IndicatorBreak,
  indicatorBreakConfigSchema,
  OppositeSignal,
  oppositeSignalConfigSchema,
  PnlStop,
  pnlStopConfigSchema,
  ProfitTarget,
  profitTargetConfigSchema,
  TrailingStop,
  trailingStopConfigSchema,
} from './rules';

// To add an exit: add its name to EXIT_REASONS, implement `ExitRule` in rules.ts (or its own
// file), then register the schema here and add a case to `createExitRule`.
export const exitRuleConfigSchema = z.discriminatedUnion('type', [
  flatBeforeCloseConfigSchema,
  pnlStopConfigSchema,
  profitTargetConfigSchema,
  trailingStopConfigSchema,
  indicatorBreakConfigSchema,
  oppositeSignalConfigSchema,
]);
export type ExitRuleConfig = z.infer<typeof exitRuleConfigSchema>;

export function createExitRule(config: ExitRuleConfig): ExitRule {
  switch (config.type) {
    case 'flatBeforeClose':
      return new FlatBeforeClose(config);
    case 'pnlStop':
      return new PnlStop(config);
    case 'profitTarget':
      return new ProfitTarget(config);
    case 'trailingStop':
      return new TrailingStop(config);
    case 'indicatorBreak':
      return new IndicatorBreak(config);
    case 'oppositeSignal':
      return new OppositeSignal();
  }
}

/** Indicator names the rule reads, so the config can check they exist. */
export function exitRuleIndicators(config: ExitRuleConfig): string[] {
  return config.type === 'indicatorBreak' ? [config.indicator] : [];
}
