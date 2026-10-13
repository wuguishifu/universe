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
import { type VoiceSession } from '../../redis/redis-keys';
import { VoiceSessionStore } from './voice-session.store';

@Injectable()
export class VoiceSessionService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(VoiceSessionService.name);
  /** Set once shutdown starts, so dropped connections stay remembered for the next start. */
  private shuttingDown = false;
  /** Per guild: pending auto-leave while the bot is alone in its channel. */
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  /** Per guild: the session of the channel the bot is in. */
  private readonly sessions = new Map<string, VoiceSession>();

  constructor(
    private readonly client: Client,
    private readonly environmentService: EnvironmentService,
    private readonly store: VoiceSessionStore,
    @Inject(JANKBOT_QUEUE_CONFIG.utterances.queueName)
    private readonly utterances: JankbotQueue<'utterances'>,
    @Inject(JANKBOT_QUEUE_CONFIG.stitchSessions.queueName)
    private readonly stitchSessions: JankbotQueue<'stitchSessions'>,
    private readonly trackingService: TrackingService,
  ) {}

  /**
   * Joins (or moves to) the channel and starts listening to everyone who speaks in it. Joining
   * starts a new session unless `continuing` is given (a rejoin or a restart).
   */
  async join(
    channel: VoiceBasedChannel,
    continuing?: Omit<VoiceSession, 'channelId'>,
  ): Promise<void> {
    const { sessionId, startedAt } = continuing ?? {
      sessionId: randomUUID(),
      startedAt: Date.now(),
    };
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
        await this.forget(channel.guild.id, 'join_failed');
      }
      throw error;
    }

    this.handleDisconnects(connection);
    const health = this.watchReceive(connection);
    connection.receiver.speaking.on('start', (userId) =>
      this.captureUtterance(connection, health, sessionId, userId),
    );
    // Moving to another channel with /join starts a new session, which ends the one it left.
    const previous = this.sessions.get(channel.guild.id);
    if (previous && previous.sessionId !== sessionId) {
      await this.endSession(channel.guild.id, previous, 'moved');
    }
    const session = { channelId: channel.id, sessionId, startedAt };
    this.sessions.set(channel.guild.id, session);
    await this.remember(channel.guild.id, session);
    this.updateIdleTimer(channel.guild);
    // The baseline for how often receive stalls happen.
    this.track(
      'voice_session-joined',
      channel.guild.id,
      channel.id,
      { continued: continuing !== undefined },
      sessionId,
    );
    this.logger.log(`Listening in #${channel.name} (${channel.guild.name})`);
  }

  /** Returns false if the bot wasn't in a voice channel in this guild. */
  async leave(
    guildId: string,
    reason: SessionEndReason = 'command',
  ): Promise<boolean> {
    const connection = getVoiceConnection(guildId);
    connection?.destroy();
    this.stopIdleTimer(guildId);
    await this.forget(guildId, reason);
    return connection !== undefined;
  }

  /** Rejoins the channels the bot was in before the gateway restarted, unless nobody is left in them. */
  @Once('clientReady')
  async restoreSessions() {
    let sessions: ({ guildId: string } & VoiceSession)[];
    try {
      sessions = await this.store.list();
    } catch (error) {
      this.logger.error('Failed to load voice sessions to rejoin', error);
      return;
    }

    await Promise.all(
      sessions.map(async ({ guildId, ...session }) => {
        const { channelId } = session;
        const channel = await this.client.channels
          .fetch(channelId)
          .catch(() => null);
        if (!channel?.isVoiceBased() || !channel.joinable) {
          this.logger.warn(
            `[${guildId}] Can't rejoin ${channelId} anymore; forgetting it`,
          );
          await this.forget(guildId, 'not_rejoined', session);
          return;
        }
        // Same outcome as sitting alone until the idle timeout: the session is over.
        if (humanCount(channel) === 0) {
          this.logger.log(
            `[${guildId}] Nobody is in #${channel.name} anymore; not rejoining`,
          );
          await this.forget(guildId, 'not_rejoined', session);
          return;
        }
        try {
          await this.join(channel, session);
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
          await this.leave(guild.id, 'disconnected');
        }
        return;
      }
      // Being dragged to another channel doesn't end the session.
      const session = this.sessions.get(guild.id);
      if (newState.channelId !== oldState.channelId && session) {
        const moved = { ...session, channelId: newState.channelId };
        this.sessions.set(guild.id, moved);
        await this.remember(guild.id, moved);
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
    sessionId: string,
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
          sessionId,
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
        void this.leave(guild.id, 'idle');
      }, voiceIdleTimeoutMs),
    );
  }

  private stopIdleTimer(guildId: string) {
    clearTimeout(this.idleTimers.get(guildId));
    this.idleTimers.delete(guildId);
  }

  // The voice connection itself doesn't depend on the store, so a Redis failure only costs the rejoin.
  private async remember(guildId: string, session: VoiceSession) {
    try {
      await this.store.save(guildId, session);
    } catch (error) {
      this.logger.warn(`[${guildId}] Failed to remember voice session`, error);
    }
  }

  /**
   * Ends the guild's session: the bot won't rejoin it, and its recordings get stitched. `session`
   * is for sessions this gateway hasn't joined since starting (see restoreSessions).
   */
  private async forget(
    guildId: string,
    reason: SessionEndReason,
    session = this.sessions.get(guildId),
  ) {
    this.sessions.delete(guildId);
    try {
      await this.store.remove(guildId);
    } catch (error) {
      this.logger.warn(`[${guildId}] Failed to forget voice session`, error);
    }
    if (session) await this.endSession(guildId, session, reason);
  }

  private async endSession(
    guildId: string,
    { channelId, sessionId, startedAt }: VoiceSession,
    reason: SessionEndReason,
  ) {
    const endedAt = Date.now();
    this.track(
      'voice_session-ended',
      guildId,
      channelId,
      {
        reason,
        // Includes any time the gateway was down mid-session, since the session continues after.
        durationMs: startedAt === undefined ? null : endedAt - startedAt,
      },
      sessionId,
    );
    try {
      await this.stitchSessions.add(
        JANKBOT_QUEUE_CONFIG.stitchSessions.jobName,
        { sessionId, guildId, channelId, startedAt, endedAt },
        { jobId: sessionId },
      );
      this.logger.log(
        `[${guildId}] Session ${sessionId} ended; queued stitching`,
      );
    } catch (error) {
      this.logger.error(
        `[${guildId}] Failed to queue stitching for session ${sessionId}`,
        error,
      );
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
        if (!this.shuttingDown) await this.forget(guildId, 'connection_lost');
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

    // Recovering from a stall continues the session rather than starting a new one.
    const session = this.sessions.get(guildId);
    const startedAt = Date.now();
    connection.destroy();
    // Otherwise the leave's voice state update can arrive after the new connection exists, and
    // onVoiceStateUpdate would take it for being kicked from the channel.
    await this.waitForVoiceLeave(channel.guild);
    try {
      await this.join(channel, session);
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
    sessionId = this.sessions.get(guildId)?.sessionId,
  ) {
    this.trackingService.trackEvent({
      name,
      properties: {
        userId: `bot-${this.environmentService.environment.name}`,
        reconciliationId: `${guildId}-${channelId}`,
        sessionId: sessionId ?? null,
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

/** Why a session ended, for analytics. */
type SessionEndReason =
  /** /leave */
  | 'command'
  /** Alone in the channel for voiceIdleTimeoutMs. */
  | 'idle'
  /** Someone disconnected the bot. */
  | 'disconnected'
  /** Kicked, or the channel was deleted, without a voice state update saying so. */
  | 'connection_lost'
  /** /join to another channel. */
  | 'moved'
  /** Left a channel to /join another, then couldn't join that one. */
  | 'join_failed'
  /** The channel was empty or gone when the gateway restarted. */
  | 'not_rejoined';

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
