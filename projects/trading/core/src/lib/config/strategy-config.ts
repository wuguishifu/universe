import { z } from 'zod';

import { contractConfigSchema } from '../contracts/contract-selector';
import { exitRuleConfigSchema, exitRuleIndicators } from '../exits/config';
import { entryFilterConfigSchema } from '../filters/config';
import { indicatorConfigSchema } from '../indicators/config';
import { riskRuleConfigSchema } from '../risk/risk-rules';
import { signalConfigSchema, signalIndicators } from '../signals/config';
import { sizingConfigSchema } from '../sizing/position-sizer';

/** Timeframes that divide evenly into the 09:30 open, so every bar starts on the open. */
export const TIMEFRAME_MINUTES = [1, 2, 3, 5, 6, 10, 15, 30] as const;

export const strategyConfigSchema = z
  .object({
    /** Underlyings to watch. Each has its own indicators and at most one position at a time. */
    tickers: z.array(z.string().min(1)).min(1),
    timeframeMinutes: z
      .number()
      .refine((m) => TIMEFRAME_MINUTES.some((t) => t === m), {
        message: `timeframeMinutes must be one of ${TIMEFRAME_MINUTES.join(', ')}`,
      }),
    /**
     * Which bars feed the indicators. `regular` ignores pre-market and after-hours, so VWAP is
     * anchored to the 09:30 open. `extended` includes them, anchoring VWAP at 04:00.
     * Entries and exits follow the regular session either way.
     */
    session: z.enum(['regular', 'extended']).default('regular'),
    /** Indicators by name. Signals and exit rules refer to them by that name. */
    indicators: z.record(z.string().min(1), indicatorConfigSchema),
    signal: signalConfigSchema,
    entryFilters: z.array(entryFilterConfigSchema).default([]),
    /** Checked in order; the first rule that matches closes the position. */
    exits: z.array(exitRuleConfigSchema).min(1),
    contract: contractConfigSchema,
    sizing: sizingConfigSchema,
    risk: z.array(riskRuleConfigSchema).default([]),
    /** Option price used for P&L exits: the bid/ask midpoint, the bid, or the last trade. */
    markPrice: z.enum(['mid', 'bid', 'last']).default('mid'),
  })
  .superRefine((config, ctx) => {
    const referenced = [
      ...signalIndicators(config.signal).map((name) => ({
        name,
        path: ['signal'],
      })),
      ...config.exits.flatMap((exit, i) =>
        exitRuleIndicators(exit).map((name) => ({ name, path: ['exits', i] })),
      ),
    ];
    for (const { name, path } of referenced) {
      if (!(name in config.indicators)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown indicator "${name}". Defined: ${Object.keys(config.indicators).join(', ') || 'none'}`,
          path,
        });
      }
    }
    if (new Set(config.tickers).size !== config.tickers.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'tickers has duplicates',
        path: ['tickers'],
      });
    }
  });

/** A config as written, with defaults still optional. */
export type StrategyConfigInput = z.input<typeof strategyConfigSchema>;
/** A config after parsing, with every default filled in. */
export type StrategyConfig = z.output<typeof strategyConfigSchema>;

/** Validates a config and fills in defaults. Throws with a readable list of problems. */
export function parseStrategyConfig(input: unknown): StrategyConfig {
  const result = strategyConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid strategy config:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
