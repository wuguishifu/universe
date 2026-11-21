import { z } from 'zod';

const ms = z.coerce.number().int().positive();
const dollars = z.coerce.number().nonnegative();

/** How the host trades, separate from the strategy. Read from the environment by the app. */
export const hostSettingsSchema = z.object({
  stockFeed: z.enum(['sip', 'iex']).default('sip'),
  optionsFeed: z.enum(['opra', 'indicative']).default('opra'),
  /** Trading days of extended-hours bars fed through `warmup`. The EMA200 on 15-minute bars needs about 10. */
  warmupDays: z.coerce.number().int().min(1).default(15),
  /** New York time to warm up and connect each trading day. */
  prepareAt: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('08:30'),
  /** New York time the session ends (stream closed, day record finalized). */
  endAt: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('20:00'),

  /** Price increment for option limit orders. QQQ options trade in pennies. */
  tick: z.coerce.number().positive().default(0.01),
  /** Entry limit is the engine's ask plus this, so it's marketable if the ask ticks up. */
  entryCushion: dollars.default(0.02),
  /** An entry that hasn't fully filled by then is canceled; whatever filled is kept. */
  entryTimeoutMs: ms.default(10_000),
  /** Exit limits start at the engine's bid and step down this often... */
  exitStepMs: ms.default(3_000),
  /** ...by this many ticks... */
  exitStepTicks: z.coerce.number().int().positive().default(1),
  /** ...this many times, then a market order. */
  exitMaxSteps: z.coerce.number().int().nonnegative().default(4),
  /** Give up on an exit order chain after this many orders and let the engine ask again. */
  exitMaxOrders: z.coerce.number().int().positive().default(10),
  /** How long to wait for a canceled order's final status. */
  cancelWaitMs: ms.default(10_000),
  /** Poll an order's status this often when the trade-update stream says nothing. */
  orderPollMs: ms.default(2_000),

  /** Poll quotes for held contracts this often. */
  quotePollMs: ms.default(2_000),
  /** Chain contracts with quotes older than this at the decision time are left out. */
  maxQuoteAgeMs: ms.default(120_000),
  /** Strikes fetched either side of the underlying price. */
  chainStrikeRange: z.coerce.number().positive().default(10),
  /** Expirations fetched, in calendar days from today. */
  chainMaxDays: z.coerce.number().int().positive().default(7),

  /** No bar for this long during regular hours counts as stale: reconnect and backfill. */
  staleBarMs: ms.default(150_000),
  /** The same outside regular hours, where quiet minutes are normal (IEX most of all). */
  staleBarExtendedMs: ms.default(20 * 60_000),
  /** Holding a position with no bar for this long during regular hours: flatten. */
  staleFlattenMs: ms.default(5 * 60_000),
  /** Flatten anything still held this many minutes before the close, as a backstop to the strategy's own exit. */
  backstopMinutesBeforeClose: z.coerce.number().nonnegative().default(2),
  /** How long shutdown keeps working exit orders before giving up. */
  shutdownFlattenTimeoutMs: ms.default(60_000),

  /** For the record's net P&L; Alpaca charges regulatory fees per contract. */
  feePerContract: dollars.default(0.05),
});

export type HostSettings = z.infer<typeof hostSettingsSchema>;
export type HostSettingsInput = z.input<typeof hostSettingsSchema>;
