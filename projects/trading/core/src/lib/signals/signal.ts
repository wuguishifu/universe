import { Bar } from '../market/types';
import { Clock, Direction, IndicatorValues } from '../strategy/types';

/** Decides whether a closed bar is a reason to enter. One instance per ticker, so it can keep state. */
export interface SignalGenerator {
  /** `clock` is when the bar closed. */
  update(indicators: IndicatorValues, bar: Bar, clock: Clock): Direction | null;
  /** Called before the first bar of each trading session. */
  startSession(): void;
}
