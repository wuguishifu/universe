import { z } from 'zod';

import { Bar } from '@projects/trading-core';

import { BrokerOrder, Log, StockFeed } from '../host/ports';

import { ReconnectingSocket, SocketStatus } from './reconnecting-socket';
import {
  dataStreamMessageSchema,
  toBrokerOrder,
  tradeStreamMessageSchema,
  tradeUpdateSchema,
} from './schemas';

type Credentials = { keyId: string; secretKey: string };

const authorizationSchema = z.object({ status: z.string() });

/** Alpaca's stock data stream: 1-minute bars and their corrections for the given tickers. */
export class BarStream {
  readonly socket: ReconnectingSocket;

  constructor(options: {
    credentials: Credentials;
    streamUrl: string;
    feed: StockFeed;
    tickers: readonly string[];
    log: Log;
    onBar: (ticker: string, bar: Bar) => void;
    onCorrection: (ticker: string, bar: Bar) => void;
    onStatus: (status: SocketStatus, details?: Record<string, unknown>) => void;
  }) {
    const { credentials, tickers, log } = options;
    this.socket = new ReconnectingSocket({
      url: `${options.streamUrl}/v2/${options.feed}`,
      name: 'bar stream',
      log,
      handlers: {
        onOpen: () => undefined,
        onStatus: options.onStatus,
        onMessage: (frame, send, ready) => {
          const messages = z.array(dataStreamMessageSchema).safeParse(frame);
          if (!messages.success) return;
          for (const message of messages.data) {
            if (message.T === 'success' && message.msg === 'connected') {
              send({
                action: 'auth',
                key: credentials.keyId,
                secret: credentials.secretKey,
              });
            } else if (
              message.T === 'success' &&
              message.msg === 'authenticated'
            ) {
              send({
                action: 'subscribe',
                bars: tickers,
                updatedBars: tickers,
              });
            } else if (message.T === 'subscription') {
              log.info('bar stream subscribed', { message });
              ready();
            } else if (message.T === 'error') {
              log.error('bar stream error', { message });
              // 402 auth failed, 404 auth timeout, 406 connection limit, 409 insufficient subscription.
              if (message.code === 402 || message.code === 409)
                this.socket.fail(`${message.code} ${message.msg ?? ''}`);
            } else if ((message.T === 'b' || message.T === 'u') && message.S) {
              const bar = toStreamBar(message);
              if (!bar) continue;
              if (message.T === 'b') options.onBar(message.S, bar);
              else options.onCorrection(message.S, bar);
            }
          }
        },
      },
    });
  }
}

function toStreamBar(
  message: z.infer<typeof dataStreamMessageSchema>,
): Bar | undefined {
  const { t, o, h, l, c, v } = message;
  if (
    t === undefined ||
    o === undefined ||
    h === undefined ||
    l === undefined ||
    c === undefined
  )
    return undefined;
  return {
    time: Date.parse(t),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v ?? 0,
  };
}

/** Alpaca's account stream: every order event, with the order's cumulative state. */
export class TradeUpdateStream {
  readonly socket: ReconnectingSocket;

  constructor(options: {
    credentials: Credentials;
    tradingUrl: string;
    log: Log;
    onUpdate: (
      event: string,
      order: BrokerOrder,
      time: number,
      payload: unknown,
    ) => void;
    onStatus: (status: SocketStatus, details?: Record<string, unknown>) => void;
  }) {
    const { credentials, log } = options;
    const url = new URL('/stream', options.tradingUrl);
    url.protocol = 'wss:';
    this.socket = new ReconnectingSocket({
      url: url.toString(),
      name: 'trade updates',
      log,
      handlers: {
        onOpen: (send) =>
          send({
            action: 'auth',
            key: credentials.keyId,
            secret: credentials.secretKey,
          }),
        onStatus: options.onStatus,
        onMessage: (frame, send, ready) => {
          const message = tradeStreamMessageSchema.safeParse(frame);
          if (!message.success) return;
          const { stream, data } = message.data;
          if (stream === 'authorization') {
            const status = authorizationSchema.safeParse(data).data?.status;
            if (status === 'authorized')
              send({ action: 'listen', data: { streams: ['trade_updates'] } });
            else this.socket.fail(`not authorized: ${JSON.stringify(data)}`);
          } else if (stream === 'listening') {
            ready();
          } else if (stream === 'trade_updates') {
            const update = tradeUpdateSchema.safeParse(data);
            if (!update.success) {
              log.warn('unparseable trade update', { data });
              return;
            }
            const order = toBrokerOrder(update.data.order);
            const time =
              Date.parse(update.data.timestamp ?? '') || order.updatedAt;
            options.onUpdate(update.data.event, order, time, data);
          }
        },
      },
    });
  }
}
