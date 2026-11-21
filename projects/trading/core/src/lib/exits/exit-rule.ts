import { Bar } from '../market/types';
import { BarSnapshot, Clock, Position } from '../strategy/types';

export const EXIT_REASONS = [
  'flatBeforeClose',
  'pnlStop',
  'profitTarget',
  'trailingStop',
  'indicatorBreak',
  'oppositeSignal',
  'underlyingStop',
  'underlyingTarget',
  /** Closed by the host through `TradingEngine.closePosition`, e.g. on shutdown or stale data. */
  'forced',
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

/**
 * What prompted an exit check:
 * - `bar`: a timeframe bar closed on the position's ticker.
 * - `mark`: a new quote moved the position's option price.
 * - `clock`: a 1-minute bar of the position's underlying arrived. `bar` is that bar.
 */
export type ExitEvent =
  | { kind: 'bar'; clock: Clock; snapshot: BarSnapshot }
  | { kind: 'mark'; clock: Clock }
  | { kind: 'clock'; clock: Clock; bar?: Bar };

/** Rules are checked in config order and the first one that matches closes the position. */
export interface ExitRule {
  readonly reason: ExitReason;
  shouldExit(position: Position, event: ExitEvent): boolean;
}
