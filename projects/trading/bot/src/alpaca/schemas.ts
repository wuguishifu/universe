import { z } from 'zod';

import { Bar } from '@projects/trading-core';

import {
  AccountInfo,
  BrokerOrder,
  BrokerPosition,
  OptionQuoteSnapshot,
} from '../host/ports';

/** Alpaca sends most numbers as strings. */
const num = z.union([z.number(), z.string()]).transform(Number);
const optionalNum = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) =>
    value === null || value === undefined ? null : Number(value),
  );

export const alpacaBarSchema = z.object({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

export const toBar = (bar: z.infer<typeof alpacaBarSchema>): Bar => ({
  time: Date.parse(bar.t),
  open: bar.o,
  high: bar.h,
  low: bar.l,
  close: bar.c,
  volume: bar.v,
});

export const barsPageSchema = z.object({
  bars: z.record(z.string(), z.array(alpacaBarSchema)).nullish(),
  next_page_token: z.string().nullish(),
});

export const calendarDaySchema = z.object({
  date: z.string(),
  open: z.string(),
  close: z.string(),
});

const alpacaQuoteSchema = z.object({
  t: z.string(),
  bp: z.number(),
  ap: z.number(),
  bs: z.number().optional(),
  as: z.number().optional(),
});

export const toOptionQuote = (
  symbol: string,
  quote: z.infer<typeof alpacaQuoteSchema>,
): OptionQuoteSnapshot => ({
  symbol,
  bid: quote.bp,
  ask: quote.ap,
  bidSize: quote.bs,
  askSize: quote.as,
  time: Date.parse(quote.t),
});

export const snapshotsPageSchema = z.object({
  snapshots: z
    .record(z.string(), z.object({ latestQuote: alpacaQuoteSchema.nullish() }))
    .nullish(),
  next_page_token: z.string().nullish(),
});

export const latestQuotesSchema = z.object({
  quotes: z.record(z.string(), alpacaQuoteSchema).nullish(),
});

export const alpacaOrderSchema = z.looseObject({
  id: z.string(),
  client_order_id: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  type: z.string().nullish(),
  order_type: z.string().nullish(),
  qty: optionalNum,
  limit_price: optionalNum,
  status: z.string(),
  filled_qty: num,
  filled_avg_price: optionalNum,
  updated_at: z.string().nullish(),
  submitted_at: z.string().nullish(),
  created_at: z.string().nullish(),
});

export const toBrokerOrder = (
  order: z.infer<typeof alpacaOrderSchema>,
): BrokerOrder => ({
  id: order.id,
  clientOrderId: order.client_order_id,
  symbol: order.symbol,
  side: order.side,
  type: order.type ?? order.order_type ?? 'unknown',
  qty: order.qty ?? 0,
  limitPrice: order.limit_price,
  status: order.status,
  filledQty: order.filled_qty,
  filledAvgPrice: order.filled_avg_price,
  updatedAt:
    Date.parse(
      order.updated_at ?? order.submitted_at ?? order.created_at ?? '',
    ) || Date.now(),
  raw: order,
});

export const alpacaPositionSchema = z.looseObject({
  symbol: z.string(),
  qty: num,
  avg_entry_price: num,
  asset_class: z.string(),
});

export const toBrokerPosition = (
  position: z.infer<typeof alpacaPositionSchema>,
): BrokerPosition => ({
  symbol: position.symbol,
  qty: position.qty,
  avgEntryPrice: position.avg_entry_price,
  assetClass: position.asset_class,
});

export const alpacaAccountSchema = z.looseObject({
  status: z.string(),
  equity: num,
  multiplier: num,
  options_approved_level: optionalNum,
  options_trading_level: optionalNum,
  pattern_day_trader: z.boolean().nullish(),
  daytrade_count: optionalNum,
  trading_blocked: z.boolean().nullish(),
  account_blocked: z.boolean().nullish(),
});

export const toAccountInfo = (
  account: z.infer<typeof alpacaAccountSchema>,
): AccountInfo => ({
  status: account.status,
  equity: account.equity,
  multiplier: account.multiplier,
  optionsApprovedLevel: account.options_approved_level,
  optionsTradingLevel: account.options_trading_level,
  patternDayTrader: account.pattern_day_trader ?? null,
  daytradeCount: account.daytrade_count,
  tradingBlocked: account.trading_blocked ?? false,
  accountBlocked: account.account_blocked ?? false,
  raw: account,
});

// --- streams -------------------------------------------------------------------------------------

/** One message on the market data stream; each frame is an array of these. */
export const dataStreamMessageSchema = z.looseObject({
  T: z.string(),
  S: z.string().optional(),
  msg: z.string().optional(),
  code: z.number().optional(),
  t: z.string().optional(),
  o: z.number().optional(),
  h: z.number().optional(),
  l: z.number().optional(),
  c: z.number().optional(),
  v: z.number().optional(),
});

export const tradeStreamMessageSchema = z.looseObject({
  stream: z.string(),
  data: z.unknown(),
});

export const tradeUpdateSchema = z.looseObject({
  event: z.string(),
  timestamp: z.string().nullish(),
  order: alpacaOrderSchema,
});
