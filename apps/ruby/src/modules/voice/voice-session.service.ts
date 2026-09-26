import {
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Client, VoiceBasedChannel } from 'discord.js';
import { randomUUID } from 'crypto';
import { EnvironmentService } from '../../environment/environment-service';
import {
  RUBY_QUEUE_CONFIG,
  type RubyJobData,
  type RubyQueue,
} from '../../queues/queue';
import { OPUS_FRAME_MS } from '../transcription/audio';

@Injectable()
export class VoiceSessionService implements OnApplicationShutdown {
  private readonly logger = new Logger(VoiceSessionService.name);

  constructor(
    private readonly client: Client,
    private readonly environmentService: EnvironmentService,
    @Inject(RUBY_QUEUE_CONFIG.utterances.queueName)
    private readonly utterances: RubyQueue<'utterances'>,
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
      throw error;
    }

    this.handleDisconnects(connection);
    connection.receiver.speaking.on('start', (userId) =>
      this.captureUtterance(connection, userId),
    );
    this.logger.log(`Listening in #${channel.name} (${channel.guild.name})`);
  }

  /** Returns false if the bot wasn't in a voice channel in this guild. */
  leave(guildId: string): boolean {
    const connection = getVoiceConnection(guildId);
    if (!connection) return false;
    connection.destroy();
    return true;
  }

  onApplicationShutdown() {
    for (const guild of this.client.guilds.cache.values()) {
      this.leave(guild.id);
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

  private async enqueue(data: RubyJobData<'utterances'>) {
    try {
      await this.utterances.add(RUBY_QUEUE_CONFIG.utterances.jobName, data);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue utterance for ${data.userId}`,
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
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }
      }
    });
  }
}
