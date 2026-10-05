import {
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  getVoiceConnections,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Client, Guild, VoiceBasedChannel, VoiceState } from 'discord.js';
import { Context, type ContextOf, On, Once } from 'necord';
import { randomUUID } from 'crypto';
import { TrackingService } from '@platform/analytics-client-nest';
import {
  JANKBOT_QUEUE_CONFIG,
  type JankbotJobData,
  type JankbotQueue,
  OPUS_FRAME_MS,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';
import { VoiceSessionStore } from './voice-session.store';

@Injectable()
export class VoiceSessionService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(VoiceSessionService.name);
  /** Set once shutdown starts, so dropped connections stay remembered for the next start. */
  private shuttingDown = false;
  /** Per guild: pending auto-leave while the bot is alone in its channel. */
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly client: Client,
    private readonly environmentService: EnvironmentService,
    private readonly store: VoiceSessionStore,
    @Inject(JANKBOT_QUEUE_CONFIG.utterances.queueName)
    private readonly utterances: JankbotQueue<'utterances'>,
    private readonly trackingService: TrackingService,
  ) {}

  /** Joins (or moves to) the channel and starts listening to everyone who speaks in it. */
  async join(channel: VoiceBasedChannel): Promise<void> {
    const existing = getVoiceConnection(channel.guild.id);
    if (existing?.joinConfig.channelId === channel.id) return;
    existing?.destroy();

    const connection = joinVoiceChannel({
      guildId: channel.guild.id,
      channelId: channel.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      // Must be undeafened to receive audio.
      selfDeaf: false,
      selfMute: true,
      // DAVE (end-to-end encryption) problems only surface as debug events; see watchReceive.
      debug: true,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      connection.destroy();
      // The bot left its previous channel to get here, so there's nothing left to rejoin.
      if (existing) {
        this.stopIdleTimer(channel.guild.id);
        await this.forget(channel.guild.id);
      }
      throw error;
    }

    this.handleDisconnects(connection);
    const health = this.watchReceive(connection);
    connection.receiver.speaking.on('start', (userId) =>
      this.captureUtterance(connection, health, userId),
    );
    await this.remember(channel.guild.id, channel.id);
    this.updateIdleTimer(channel.guild);
    // The baseline for how often receive stalls happen.
    this.track('voice_session-joined', channel.guild.id, channel.id);
    this.logger.log(`Listening in #${channel.name} (${channel.guild.name})`);
  }

  /** Returns false if the bot wasn't in a voice channel in this guild. */
  async leave(guildId: string): Promise<boolean> {
    const connection = getVoiceConnection(guildId);
    connection?.destroy();
    this.stopIdleTimer(guildId);
    await this.forget(guildId);
    return connection !== undefined;
  }

  /** Rejoins the channels the bot was in before the gateway restarted, unless nobody is left in them. */
  @Once('clientReady')
  async restoreSessions() {
    let sessions: { guildId: string; channelId: string }[];
    try {
      sessions = await this.store.list();
    } catch (error) {
      this.logger.error('Failed to load voice sessions to rejoin', error);
      return;
    }

    await Promise.all(
      sessions.map(async ({ guildId, channelId }) => {
        const channel = await this.client.channels
          .fetch(channelId)
          .catch(() => null);
        if (!channel?.isVoiceBased() || !channel.joinable) {
          this.logger.warn(
            `[${guildId}] Can't rejoin ${channelId} anymore; forgetting it`,
          );
          await this.forget(guildId);
          return;
        }
        // Same outcome as sitting alone until the idle timeout: the session is over.
        if (humanCount(channel) === 0) {
          this.logger.log(
            `[${guildId}] Nobody is in #${channel.name} anymore; not rejoining`,
          );
          await this.forget(guildId);
          return;
        }
        try {
          await this.join(channel);
        } catch (error) {
          // Kept, so the next restart tries again; /leave forgets it.
          this.logger.error(
            `[${guildId}] Failed to rejoin ${channelId}`,
            error,
          );
        }
      }),
    );
  }

  /**
   * Treats being disconnected by someone else like `/leave`, keeps the remembered channel current
   * when someone drags the bot to another channel, and starts or cancels the idle timeout as people
   * come and go.
   */
  @On('voiceStateUpdate')
  async onVoiceStateUpdate(
    @Context() [oldState, newState]: ContextOf<'voiceStateUpdate'>,
  ) {
    const { guild } = newState;
    const connection = getVoiceConnection(guild.id);
    // Our own leaves destroy the connection first, so they stop here.
    if (!connection) return;

    if (newState.id === this.client.user?.id) {
      if (!newState.channelId) {
        // The channel check ignores the old channel's leave when /join moves the bot elsewhere.
        if (oldState.channelId === connection.joinConfig.channelId) {
          this.logger.log(
            `[${guild.id}] Disconnected from ${oldState.channelId}; leaving`,
          );
          await this.leave(guild.id);
        }
        return;
      }
      if (newState.channelId !== oldState.channelId) {
        await this.remember(guild.id, newState.channelId);
      }
    }
    this.updateIdleTimer(guild);
  }

  beforeApplicationShutdown() {
    this.shuttingDown = true;
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const connection of getVoiceConnections().values()) {
      connection.destroy();
    }
  }

  private captureUtterance(
    connection: VoiceConnection,
    health: ReceiveHealth,
    userId: string,
  ) {
    const { receiver } = connection;
    if (this.client.users.cache.get(userId)?.bot) return;
    // 'start' fires as soon as the user's packets arrive, before they're decrypted.
    health.unheardSince ??= Date.now();
    // Already capturing this user; 'start' fires again after short pauses within an utterance.
    if (receiver.subscriptions.has(userId)) return;

    const { utteranceMinMs, utteranceMaxMs, utteranceSilenceMs } =
      this.environmentService.environment;
    const guildId = connection.joinConfig.guildId;
    const { channelId } = connection.joinConfig;
    if (!channelId) return; // not connected to a channel
    const minPackets = Math.ceil(utteranceMinMs / OPUS_FRAME_MS);
    const maxPackets = Math.floor(utteranceMaxMs / OPUS_FRAME_MS);

    const stream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: utteranceSilenceMs,
      },
    });

    let packets: Buffer[] = [];
    let startedAt = Date.now();

    const flush = () => {
      if (packets.length >= minPackets) {
        void this.enqueue({
          utteranceId: randomUUID(),
          guildId,
          channelId,
          userId,
          startedAt,
          opusPackets: packets.map((packet) => packet.toString('base64')),
        });
      }
      packets = [];
      startedAt = Date.now();
    };

    stream.on('data', (packet: Buffer) => {
      health.unheardSince = undefined;
      health.decryptFailures = 0;
      packets.push(packet);
      // Split very long monologues so transcription stays bounded. A phrase spanning the
      // split point can be missed, which is an acceptable trade-off.
      if (packets.length >= maxPackets) flush();
    });
    stream.once('end', flush);
    stream.once('error', (error) =>
      this.logger.warn(`Audio stream error for ${userId}: ${error.message}`),
    );
  }

  private async enqueue(data: JankbotJobData<'utterances'>) {
    try {
      await this.utterances.add(JANKBOT_QUEUE_CONFIG.utterances.jobName, data);
      this.logger.debug(
        `[${data.guildId}] ${data.userId}: queued ${((data.opusPackets.length * OPUS_FRAME_MS) / 1000).toFixed(1)}s of audio`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue utterance for ${data.userId}`,
        error,
      );
    }
  }

  /** Starts the idle timeout if the bot is alone in its channel, and cancels it otherwise. */
  private updateIdleTimer(guild: Guild) {
    // discord.js's cache, not joinConfig: it's already current when the bot is dragged elsewhere.
    const channel = guild.members.me?.voice.channel;
    if (!channel || humanCount(channel) > 0) {
      this.stopIdleTimer(guild.id);
      return;
    }
    if (this.idleTimers.has(guild.id)) return;

    const { voiceIdleTimeoutMs } = this.environmentService.environment;
    this.idleTimers.set(
      guild.id,
      setTimeout(() => {
        this.idleTimers.delete(guild.id);
        const current = guild.members.me?.voice.channel;
        if (!current || humanCount(current) > 0) return;
        this.logger.log(
          `[${guild.id}] Alone in #${current.name} for ${voiceIdleTimeoutMs / 1000}s; leaving`,
        );
        void this.leave(guild.id);
      }, voiceIdleTimeoutMs),
    );
  }

  private stopIdleTimer(guildId: string) {
    clearTimeout(this.idleTimers.get(guildId));
    this.idleTimers.delete(guildId);
  }

  // The voice connection itself doesn't depend on the store, so a Redis failure only costs the rejoin.
  private async remember(guildId: string, channelId: string) {
    try {
      await this.store.save(guildId, channelId);
    } catch (error) {
      this.logger.warn(`[${guildId}] Failed to remember voice session`, error);
    }
  }

  private async forget(guildId: string) {
    try {
      await this.store.remove(guildId);
    } catch (error) {
      this.logger.warn(`[${guildId}] Failed to forget voice session`, error);
    }
  }

  /**
   * Standard @discordjs/voice reconnect handling: if we were moved between channels the
   * connection recovers on its own, otherwise give up and clean up.
   */
  private handleDisconnects(connection: VoiceConnection) {
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        const { guildId } = connection.joinConfig;
        // Already handled (by /leave or the voice state update), or replaced by a newer /join
        // whose session isn't ours to forget.
        if (getVoiceConnection(guildId) !== connection) return;
        connection.destroy();
        this.stopIdleTimer(guildId);
        // Kicked, or the channel was deleted. A shutdown also drops the connection, but that
        // session should survive the restart.
        if (!this.shuttingDown) await this.forget(guildId);
      }
    });
  }

  /**
   * Logs connection state changes and DAVE events, and rejoins when people keep speaking but no
   * audio gets through. @discordjs/voice silently drops packets it can't decrypt while a DAVE
   * transition is pending, and a transition whose commit never arrives stays pending forever: the
   * connection looks healthy but hears nothing until it's recreated.
   */
  private watchReceive(connection: VoiceConnection): ReceiveHealth {
    const { guildId, channelId } = connection.joinConfig;
    const health: ReceiveHealth = {
      unheardSince: undefined,
      decryptFailures: 0,
      lastDaveEvent: undefined,
    };

    connection.on('stateChange', (oldState, newState) => {
      if (oldState.status === newState.status) return;
      this.logger.log(
        `[${guildId}] Voice connection ${oldState.status} -> ${newState.status}`,
      );
    });
    connection.on('debug', (message) => {
      // The rest is websocket and UDP traffic.
      if (!message.includes('[DAVE]')) return;
      // One per dropped packet, so they're counted and reported with the stall instead.
      if (message.includes('Failed to decrypt')) {
        health.decryptFailures++;
        return;
      }
      health.lastDaveEvent = message;
      this.logger.log(`[${guildId}] ${message}`);
      // @discordjs/voice recovering from a bad transition on its own; happens with or without a stall.
      if (message.includes('errored') || message.includes('Invalidating')) {
        this.track('voice_session-dave-error', guildId, channelId, { message });
      }
    });

    const { voiceReceiveStallMs } = this.environmentService.environment;
    const timer = setInterval(() => {
      if (health.unheardSince === undefined) return;
      const unheardMs = Date.now() - health.unheardSince;
      if (unheardMs < voiceReceiveStallMs) return;
      clearInterval(timer);
      this.logger.warn(
        `[${guildId}] No audio for ${Math.round(unheardMs / 1000)}s while people were speaking (${health.decryptFailures} decrypt failures); rejoining`,
      );
      this.track('voice_session-receive-stalled', guildId, channelId, {
        unheardMs,
        decryptFailures: health.decryptFailures,
        // Which DAVE step it was stuck after, e.g. a transition that was prepared but never executed.
        lastDaveEvent: health.lastDaveEvent,
      });
      void this.rejoin(connection);
    }, 5_000);
    connection.once(VoiceConnectionStatus.Destroyed, () =>
      clearInterval(timer),
    );

    return health;
  }

  /** Recreates a connection that stopped receiving audio, in the same channel. */
  private async rejoin(connection: VoiceConnection) {
    const { guildId, channelId } = connection.joinConfig;
    // Left or replaced since the stall was detected.
    if (getVoiceConnection(guildId) !== connection || !channelId) return;

    const channel = await this.client.channels
      .fetch(channelId)
      .catch(() => null);
    if (!channel?.isVoiceBased()) return;

    const startedAt = Date.now();
    connection.destroy();
    // Otherwise the leave's voice state update can arrive after the new connection exists, and
    // onVoiceStateUpdate would take it for being kicked from the channel.
    await this.waitForVoiceLeave(channel.guild);
    try {
      await this.join(channel);
      this.track('voice_session-rejoined', guildId, channelId, {
        succeeded: true,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.track('voice_session-rejoined', guildId, channelId, {
        succeeded: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      // Kept, so the next restart tries again, as in restoreSessions.
      this.logger.error(`[${guildId}] Failed to rejoin ${channelId}`, error);
    }
  }

  private track(
    name: string,
    guildId: string,
    channelId: string | null,
    extra?: Record<string, unknown>,
  ) {
    this.trackingService.trackEvent({
      name,
      properties: {
        userId: `bot-${this.environmentService.environment.name}`,
        reconciliationId: `${guildId}-${channelId}`,
      },
      extra,
    });
  }

  /** Resolves once Discord confirms the bot left voice in this guild, or after 5s. */
  private waitForVoiceLeave(guild: Guild): Promise<void> {
    if (!guild.members.me?.voice.channelId) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        this.client.off('voiceStateUpdate', onUpdate);
        resolve();
      };
      const onUpdate = (_: VoiceState, state: VoiceState) => {
        if (
          state.guild.id === guild.id &&
          state.id === this.client.user?.id &&
          !state.channelId
        ) {
          done();
        }
      };
      const timeout = setTimeout(done, 5_000);
      this.client.on('voiceStateUpdate', onUpdate);
    });
  }
}

/** Per connection: whether audio is getting through to the speakers' streams. */
type ReceiveHealth = {
  /** When someone started speaking with no packet reaching a stream since. */
  unheardSince: number | undefined;
  /** Packets DAVE failed to decrypt since the last one that got through. */
  decryptFailures: number;
  /** The most recent DAVE debug message other than a decrypt failure. */
  lastDaveEvent: string | undefined;
};

/** Other bots don't count as company. */
function humanCount(channel: VoiceBasedChannel): number {
  return channel.members.filter((member) => !member.user.bot).size;
}
