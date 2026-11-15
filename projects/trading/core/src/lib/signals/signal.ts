import { Bar } from '../market/types';
import { Direction, IndicatorValues } from '../strategy/types';

/** Decides whether a closed bar is a reason to enter. One instance per ticker, so it can keep state. */
export interface SignalGenerator {
  update(indicators: IndicatorValues, bar: Bar): Direction | null;
  /** Called before the first bar of each trading session. */
  startSession(): void;
}
