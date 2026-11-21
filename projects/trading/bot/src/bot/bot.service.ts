import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import {
  nyTime,
  parseStrategyConfig,
  PREMARKET_BOX_BREAKOUT,
  StrategyConfigInput,
} from '@projects/trading-core';

import { AlpacaRest, assertPaper } from '../alpaca/alpaca-rest';
import { BarStream, TradeUpdateStream } from '../alpaca/streams';
import { EnvironmentService } from '../config/environment';
import { addDays, nyEpochAt } from '../host/ny-clock';
import { realTimers } from '../host/ports';
import { HostSettings, hostSettingsSchema } from '../host/settings';
import { BOT_ORDER_PREFIX, TradingHost } from '../host/trading-host';
import { TradingStore } from '../persistence/trading-store';

import { nestLog } from './nest-log';

const STRATEGIES: Record<string, StrategyConfigInput> = {
  'premarket-box-breakout': PREMARKET_BOX_BREAKOUT,
};

/**
 * Runs the bot: one `TradingHost` per trading day, from `prepareAt` (08:30 New York) to `endAt`
 * (20:00). Stopping the process is the kill switch: Nest's shutdown hooks call `onModuleDestroy`,
 * which cancels entries, sells every position at market and writes the record before exiting.
 * Give the pod a termination grace period longer than `SHUTDOWN_FLATTEN_TIMEOUT_MS`.
 */
@Injectable()
export class BotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Bot');
  private readonly log = nestLog(this.logger);
  readonly runId = `${BOT_ORDER_PREFIX}${Date.now().toString(36)}`;
  private readonly settings: HostSettings;
  private readonly strategy: StrategyConfigInput;
  private host: TradingHost | undefined;
  private bars: BarStream | undefined;
  private trades: TradeUpdateStream | undefined;
  private stopping = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly store: TradingStore,
  ) {
    const env = environmentService.environment;
    assertPaper({ keyId: env.apcaApiKeyId, tradingUrl: env.apcaApiBaseUrl });
    this.settings = hostSettingsSchema.parse(env);
    const strategy = STRATEGIES[env.strategy];
    if (!strategy) throw new Error(`Unknown strategy ${env.strategy}`);
    this.strategy = strategy;
  }

  onApplicationBootstrap(): void {
    const env = this.environmentService.environment;
    this.store.startRun({
      id: this.runId,
      version: env.version,
      environment: env.environment,
      account: 'paper',
      stockFeed: this.settings.stockFeed,
      optionsFeed: this.settings.optionsFeed,
      strategy: parseStrategyConfig(this.strategy),
      settings: this.settings,
    });
    this.log.info('starting', { runId: this.runId, settings: this.settings });
    void this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    this.log.warn('shutting down: flattening', { runId: this.runId });
    try {
      await this.host?.shutdown('process shutting down');
    } finally {
      this.stopStreams();
      this.store.endRun(this.runId, 'shutdown');
      await this.store.flush();
      this.log.info('shut down', { runId: this.runId });
    }
  }

  status() {
    const host = this.host;
    return {
      runId: this.runId,
      stopping: this.stopping,
      date: host?.tradingDate ?? null,
      positions: host?.positions ?? [],
      entryBlockers: host?.blockers ?? [],
      bars: host?.barStats ?? null,
      recorderBacklog: this.store.backlog,
      feeds: {
        stock: this.settings.stockFeed,
        options: this.settings.optionsFeed,
      },
    };
  }

  private async run(): Promise<void> {
    const env = this.environmentService.environment;
    const rest = new AlpacaRest(
      {
        keyId: env.apcaApiKeyId,
        secretKey: env.apcaApiSecretKey,
        tradingUrl: env.apcaApiBaseUrl,
        dataUrl: env.apcaDataUrl,
        stockFeed: this.settings.stockFeed,
        optionsFeed: this.settings.optionsFeed,
        minIntervalMs: env.apcaMinIntervalMs,
      },
      this.log,
    );

    while (!this.stopping) {
      try {
        const now = Date.now();
        const today = nyTime(now).date;
        const days = await rest.calendar(today, addDays(today, 10));
        const session = days.find(
          (day) =>
            day.date >= today && nyEpochAt(day.date, this.settings.endAt) > now,
        );
        if (!session) {
          await this.sleepUntil(now + 6 * 3_600_000);
          continue;
        }
        const prepareAt = nyEpochAt(session.date, this.settings.prepareAt);
        if (now < prepareAt) {
          this.log.info('waiting for the next session', {
            date: session.date,
            prepareAt: new Date(prepareAt).toISOString(),
          });
          await this.sleepUntil(prepareAt);
          continue;
        }
        await this.runSession(
          rest,
          session.date,
          nyEpochAt(session.date, this.settings.endAt),
        );
      } catch (error) {
        this.log.error('session failed', {
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        this.store.incident(this.runId, Date.now(), 'sessionFailed', {
          error: String(error),
        });
        this.stopStreams();
        this.host = undefined;
        await this.sleepUntil(Date.now() + 60_000);
      }
    }
  }

  private async runSession(
    rest: AlpacaRest,
    date: string,
    endAt: number,
  ): Promise<void> {
    const env = this.environmentService.environment;
    const credentials = {
      keyId: env.apcaApiKeyId,
      secretKey: env.apcaApiSecretKey,
    };
    const host = new TradingHost({
      runId: this.runId,
      strategy: this.strategy,
      settings: this.settings,
      broker: rest,
      data: rest,
      recorder: this.store,
      timers: realTimers,
      log: this.log,
      live: true,
    });

    // Trade updates first, so fills from reconciliation's cancels aren't missed.
    this.trades = new TradeUpdateStream({
      credentials,
      tradingUrl: env.apcaApiBaseUrl,
      log: this.log,
      onUpdate: (event, order, time, payload) =>
        host.onTradeUpdate(event, order, time, payload),
      onStatus: (status, details) =>
        host.onStreamStatus('tradeUpdates', status, details),
    });
    this.trades.socket.start();

    this.host = host;
    await host.prepare(date);
    if (this.stopping) return;

    const bars = new BarStream({
      credentials,
      streamUrl: env.apcaStreamUrl,
      feed: this.settings.stockFeed,
      tickers: host.config.tickers,
      log: this.log,
      onBar: (_ticker, bar) => void host.onStreamBar(bar),
      onCorrection: (_ticker, bar) => host.onBarCorrection(bar),
      onStatus: (status, details) =>
        host.onStreamStatus('bars', status, details),
    });
    this.bars = bars;
    host.onStale = () => bars.socket.reconnect('stale bars');
    bars.socket.start();
    host.start();
    this.log.info('session live', {
      date,
      endAt: new Date(endAt).toISOString(),
    });

    await this.sleepUntil(endAt);
    if (this.stopping) return;
    await host.endDay();
    this.stopStreams();
    this.host = undefined;
    this.log.info('session over', { date });
  }

  private stopStreams(): void {
    this.bars?.socket.stop();
    this.trades?.socket.stop();
    this.bars = undefined;
    this.trades = undefined;
  }

  /** Sleeps until `time`, or until shutdown begins. */
  private async sleepUntil(time: number): Promise<void> {
    while (!this.stopping && Date.now() < time) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(60_000, time - Date.now()));
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
}
