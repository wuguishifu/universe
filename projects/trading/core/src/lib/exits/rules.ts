import { z } from 'zod';

import { pnlPct, Position, positionPnlPct } from '../strategy/types';

import { ExitEvent, ExitRule } from './exit-rule';

const fraction = z.number().positive();

// --- flatBeforeClose ---------------------------------------------------------------------------

export const flatBeforeCloseConfigSchema = z.object({
  type: z.literal('flatBeforeClose'),
  /** Close everything this many minutes before the regular session ends. */
  minutes: z.number().nonnegative().default(10),
});

/** Also closes anything still held from an earlier day, the first chance it gets. */
export class FlatBeforeClose implements ExitRule {
  readonly reason = 'flatBeforeClose';
  private readonly minutes: number;

  constructor(config: z.infer<typeof flatBeforeCloseConfigSchema>) {
    this.minutes = config.minutes;
  }

  shouldExit(position: Position, { clock }: ExitEvent): boolean {
    if (clock.date !== position.entryDate) return true;
    return (
      clock.hours !== null && clock.minute >= clock.hours.close - this.minutes
    );
  }
}

// --- pnlStop -----------------------------------------------------------------------------------

export const pnlStopConfigSchema = z.object({
  type: z.literal('pnlStop'),
  /** Loss that triggers the stop, as a fraction of the premium paid. 0.3 exits at -30%. */
  pct: fraction,
});

export class PnlStop implements ExitRule {
  readonly reason = 'pnlStop';
  private readonly pct: number;

  constructor(config: z.infer<typeof pnlStopConfigSchema>) {
    this.pct = config.pct;
  }

  shouldExit(position: Position, event: ExitEvent): boolean {
    return event.kind === 'mark' && positionPnlPct(position) <= -this.pct;
  }
}

// --- profitTarget ------------------------------------------------------------------------------

export const profitTargetConfigSchema = z.object({
  type: z.literal('profitTarget'),
  /** Gain that takes profit, as a fraction of the premium paid. 0.5 exits at +50%. */
  pct: fraction,
});

export class ProfitTarget implements ExitRule {
  readonly reason = 'profitTarget';
  private readonly pct: number;

  constructor(config: z.infer<typeof profitTargetConfigSchema>) {
    this.pct = config.pct;
  }

  shouldExit(position: Position, event: ExitEvent): boolean {
    return event.kind === 'mark' && positionPnlPct(position) >= this.pct;
  }
}

// --- trailingStop ------------------------------------------------------------------------------

export const trailingStopConfigSchema = z.object({
  type: z.literal('trailingStop'),
  /** Exit once the price falls this fraction below its highest point since entry. */
  pct: fraction,
  /** Only start trailing once the position has been up at least this much. 0 trails from the start. */
  activateAtPct: z.number().nonnegative().default(0),
});

export class TrailingStop implements ExitRule {
  readonly reason = 'trailingStop';
  private readonly config: z.infer<typeof trailingStopConfigSchema>;

  constructor(config: z.infer<typeof trailingStopConfigSchema>) {
    this.config = config;
  }

  shouldExit(position: Position, event: ExitEvent): boolean {
    if (event.kind !== 'mark') return false;
    const activated =
      pnlPct(position.entryPrice, position.peakMark) >=
      this.config.activateAtPct;
    return (
      activated && position.mark <= position.peakMark * (1 - this.config.pct)
    );
  }
}

// --- indicatorBreak ----------------------------------------------------------------------------

export const indicatorBreakConfigSchema = z.object({
  type: z.literal('indicatorBreak'),
  /** Indicator name from the config, e.g. `ema9`. */
  indicator: z.string().min(1),
  /**
   * `close`: a bar closes on the wrong side of the indicator.
   * `wick`: any part of a bar reaches the wrong side (the low for calls, the high for puts).
   */
  trigger: z.enum(['close', 'wick']).default('close'),
  /** A different indicator for puts, e.g. the lower edge of a band when `indicator` is the upper. */
  bearishIndicator: z.string().min(1).optional(),
});

/** Exits when the underlying breaks through an indicator against the position. Not checked on the entry bar. */
export class IndicatorBreak implements ExitRule {
  readonly reason = 'indicatorBreak';
  private readonly config: z.infer<typeof indicatorBreakConfigSchema>;

  constructor(config: z.infer<typeof indicatorBreakConfigSchema>) {
    this.config = config;
  }

  shouldExit(position: Position, event: ExitEvent): boolean {
    if (event.kind !== 'bar') return false;
    const { bar, index, indicators } = event.snapshot;
    const name =
      position.direction === 'bearish'
        ? (this.config.bearishIndicator ?? this.config.indicator)
        : this.config.indicator;
    const level = indicators[name];
    if (level === undefined || index <= position.entryBarIndex) return false;

    const wick = this.config.trigger === 'wick';
    return position.direction === 'bullish'
      ? (wick ? bar.low : bar.close) < level
      : (wick ? bar.high : bar.close) > level;
  }
}

// --- oppositeSignal ----------------------------------------------------------------------------

export const oppositeSignalConfigSchema = z.object({
  type: z.literal('oppositeSignal'),
});

/** Exits when the entry signal fires the other way. The engine may then enter that way too. */
export class OppositeSignal implements ExitRule {
  readonly reason = 'oppositeSignal';

  shouldExit(position: Position, event: ExitEvent): boolean {
    if (event.kind !== 'bar') return false;
    const { signal } = event.snapshot;
    return signal !== null && signal !== position.direction;
  }
}
