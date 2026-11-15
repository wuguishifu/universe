import { ExitReason } from '../exits/exit-rule';
import { Clock, Direction, IndicatorValues } from '../strategy/types';

export type LastExit = { reason: ExitReason; barIndex: number; time: number };

export type EntryContext = {
  ticker: string;
  direction: Direction;
  clock: Clock;
  /** Index of the timeframe bar that produced the signal. */
  barIndex: number;
  /** The most recent exit on this ticker, if any. */
  lastExit?: LastExit;
  /** Entries already made on this ticker today. */
  entriesToday: number;
  /** Indicator values on the bar that produced the signal. */
  indicators: IndicatorValues;
};

/** A gate on new entries. Every filter must allow a signal before a contract is picked. */
export interface EntryFilter {
  readonly name: string;
  allow(context: EntryContext): boolean;
}
