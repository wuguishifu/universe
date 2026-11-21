import { OptionType } from '@projects/trading-core';

export type OccContract = {
  underlying: string;
  /** `YYYY-MM-DD` */
  expiration: string;
  type: OptionType;
  strike: number;
};

const OCC_PATTERN = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/** `QQQ261117C00590000` → QQQ, 2026-11-17, call, 590. Null if it isn't an OCC symbol. */
export function parseOccSymbol(symbol: string): OccContract | null {
  const match = OCC_PATTERN.exec(symbol);
  if (!match) return null;
  const [, underlying = '', yy, mm, dd, cp, strike] = match;
  return {
    underlying,
    expiration: `20${yy}-${mm}-${dd}`,
    type: cp === 'C' ? 'call' : 'put',
    strike: Number(strike) / 1000,
  };
}
