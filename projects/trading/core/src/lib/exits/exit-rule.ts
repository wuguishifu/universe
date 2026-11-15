import { BarSnapshot, Clock, Position } from '../strategy/types';

export const EXIT_REASONS = [
  'flatBeforeClose',
  'pnlStop',
  'profitTarget',
  'trailingStop',
  'indicatorBreak',
  'oppositeSignal',
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

/**
 * What prompted an exit check:
 * - `bar`: a timeframe bar closed on the position's ticker.
 * - `mark`: a new quote moved the position's option price.
 * - `clock`: time passed (a 1-minute bar arrived) with nothing else to check.
 */
export type ExitEvent =
  | { kind: 'bar'; clock: Clock; snapshot: BarSnapshot }
  | { kind: 'mark'; clock: Clock }
  | { kind: 'clock'; clock: Clock };

/** Rules are checked in config order and the first one that matches closes the position. */
export interface ExitRule {
  readonly reason: ExitReason;
  shouldExit(position: Position, event: ExitEvent): boolean;
}
