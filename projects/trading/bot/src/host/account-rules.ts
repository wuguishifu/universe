import { AccountInfo } from './ports';

export const PDT_EQUITY = 25_000;
export const PDT_MAX_DAY_TRADES = 3;
/** Alpaca's level for buying calls and puts. */
export const LONG_OPTIONS_LEVEL = 2;

export type AccountCheck = {
  /** Why new entries aren't allowed today; empty when they are. */
  blockers: string[];
  /** Worth knowing, but not a reason to stop. */
  warnings: string[];
};

/**
 * Reads the account's own rules and says whether the bot may open a position today. It never
 * tries to get around them: every trade here opens and closes the same day, so each is a day trade.
 */
export function checkAccount(account: AccountInfo): AccountCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (account.status !== 'ACTIVE')
    blockers.push(`account status is ${account.status}`);
  if (account.accountBlocked) blockers.push('account is blocked');
  if (account.tradingBlocked) blockers.push('trading is blocked');

  const level = account.optionsApprovedLevel ?? account.optionsTradingLevel;
  if (level === null) warnings.push('options level not reported');
  else if (level < LONG_OPTIONS_LEVEL)
    blockers.push(
      `options level ${level} is below ${LONG_OPTIONS_LEVEL}, needed to buy options`,
    );

  const margin = account.multiplier > 1;
  if (margin && account.equity < PDT_EQUITY) {
    warnings.push(
      `margin account under $${PDT_EQUITY.toLocaleString('en-US')}: each round trip is a day trade, ${PDT_MAX_DAY_TRADES} allowed in 5 business days`,
    );
    if (account.daytradeCount === null)
      warnings.push(
        'day trade count not reported; the broker will enforce the limit',
      );
    else if (account.daytradeCount >= PDT_MAX_DAY_TRADES)
      blockers.push(
        `${account.daytradeCount} day trades in the last 5 business days; another would break the pattern day trader rule`,
      );
  }
  if (account.patternDayTrader === true && account.equity < PDT_EQUITY)
    blockers.push(
      `flagged pattern day trader with equity under $${PDT_EQUITY.toLocaleString('en-US')}`,
    );
  if (account.patternDayTrader === null && account.daytradeCount === null)
    warnings.push('pattern day trader fields not reported');

  return { blockers, warnings };
}
