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
import { Client, VoiceBasedChannel } from 'discord.js';
import { Context, type ContextOf, On, Once } from 'necord';
import { randomUUID } from 'crypto';
import {
  JANKBOT_QUEUE_CONFIG,
  type JankbotJobData,
  type JankbotQueue,
  OPUS_FRAME_MS,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment-service';
import { VoiceSessionStore } from './voice-session.store';

@Injectable()
export class VoiceSessionService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(VoiceSessionService.name);
  /** Set once shutdown starts, so dropped connections stay remembered for the next start. */
  private shuttingDown = false;

  constructor(
    private readonly client: Client,
    private readonly environmentService: EnvironmentService,
    private readonly store: VoiceSessionStore,
    @Inject(JANKBOT_QUEUE_CONFIG.utterances.queueName)
    private readonly utterances: JankbotQueue<'utterances'>,
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
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      connection.destroy();
      // The bot left its previous channel to get here, so there's nothing left to rejoin.
      if (existing) await this.forget(channel.guild.id);
      throw error;
    }

    this.handleDisconnects(connection);
    connection.receiver.speaking.on('start', (userId) =>
      this.captureUtterance(connection, userId),
    );
    await this.remember(channel.guild.id, channel.id);
    this.logger.log(`Listening in #${channel.name} (${channel.guild.name})`);
  }

  /** Returns false if the bot wasn't in a voice channel in this guild. */
  async leave(guildId: string): Promise<boolean> {
    const connection = getVoiceConnection(guildId);
    connection?.destroy();
    await this.forget(guildId);
    return connection !== undefined;
  }

  /** Rejoins the channels the bot was in before the gateway restarted. */
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

  /** Keeps the remembered channel current when someone drags the bot to another channel. */
  @On('voiceStateUpdate')
  async onVoiceStateUpdate(
    @Context() [oldState, newState]: ContextOf<'voiceStateUpdate'>,
  ) {
    if (newState.id !== this.client.user?.id) return;
    if (!newState.channelId || newState.channelId === oldState.channelId) {
      return;
    }
    if (!getVoiceConnection(newState.guild.id)) return;
    await this.remember(newState.guild.id, newState.channelId);
  }

  beforeApplicationShutdown() {
    this.shuttingDown = true;
    for (const connection of getVoiceConnections().values()) {
      connection.destroy();
    }
  }

  private captureUtterance(connection: VoiceConnection, userId: string) {
    const { receiver } = connection;
    // Already capturing this user; 'start' fires again after short pauses within an utterance.
    if (receiver.subscriptions.has(userId)) return;
    if (this.client.users.cache.get(userId)?.bot) return;

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
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }
        // Kicked, or the channel was deleted. A shutdown also drops the connection, but that
        // session should survive the restart.
        if (!this.shuttingDown) {
          await this.forget(connection.joinConfig.guildId);
        }
      }
    });
  }
}
