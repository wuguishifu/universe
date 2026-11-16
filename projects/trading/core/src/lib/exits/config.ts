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
  UnderlyingStop,
  underlyingStopConfigSchema,
  UnderlyingTarget,
  underlyingTargetConfigSchema,
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
  underlyingStopConfigSchema,
  underlyingTargetConfigSchema,
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
    case 'underlyingStop':
      return new UnderlyingStop(config);
    case 'underlyingTarget':
      return new UnderlyingTarget(config);
  }
}

/** Indicator names the rule reads, so the config can check they exist. */
export function exitRuleIndicators(config: ExitRuleConfig): string[] {
  const names = (main: string, bearish: string | undefined): string[] =>
    bearish ? [main, bearish] : [main];
  switch (config.type) {
    case 'indicatorBreak':
    case 'underlyingStop':
      return names(config.indicator, config.bearishIndicator);
    case 'underlyingTarget':
      return names(config.stopIndicator, config.bearishStopIndicator);
    default:
      return [];
  }
}
