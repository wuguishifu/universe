import { z } from 'zod';

import { Bar, OptionType } from '@projects/trading-core';

/** A bar as Alpaca's market data API returns it. Extra fields (`n`, `vw`) are ignored. */
export const alpacaBarSchema = z.object({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});
export type AlpacaBar = z.infer<typeof alpacaBarSchema>;

export const toBar = (bar: AlpacaBar): Bar => ({
  time: Date.parse(bar.t),
  open: bar.o,
  high: bar.h,
  low: bar.l,
  close: bar.c,
  volume: bar.v,
});

/** A day from `/v2/calendar`. Parsing drops the extra fields. */
export const alpacaCalendarDaySchema = z.object({
  date: z.string(),
  open: z.string(),
  close: z.string(),
});

export type OccContract = {
  underlying: string;
  /** `YYYY-MM-DD` */
  expiration: string;
  type: OptionType;
  strike: number;
};

const OCC_PATTERN = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/** `SPY261117C00590000` → SPY, 2026-11-17, call, 590. Null if it isn't an OCC symbol. */
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

export function occSymbol({
  underlying,
  expiration,
  type,
  strike,
}: OccContract): string {
  const yymmdd = expiration.slice(2).replaceAll('-', '');
  const side = type === 'call' ? 'C' : 'P';
  const strikeDigits = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${underlying}${yymmdd}${side}${strikeDigits}`;
}
