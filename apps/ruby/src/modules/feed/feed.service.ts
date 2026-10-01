import { Injectable, Logger } from '@nestjs/common';
import { Client, DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { Subject } from 'rxjs';
import {
  type FeedGuild,
  type FeedUtterance,
  RUBY_FEED_HISTORY_SIZE,
} from '@universe/contracts-ruby';
import type { RubyJobData } from '../../queues/queue';
import { SpeakerProfilesService } from './speaker-profiles.service';

/**
 * The last {@link RUBY_FEED_HISTORY_SIZE} transcripts per server, kept in memory only, so a
 * restart clears them. Also fans new transcripts out to the feed socket.
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private readonly history = new Map<string, FeedUtterance[]>();
  private readonly added = new Subject<FeedUtterance>();
  readonly added$ = this.added.asObservable();

  constructor(
    private readonly client: Client,
    private readonly speakerProfiles: SpeakerProfilesService,
  ) {}

  async record(
    {
      utteranceId,
      guildId,
      channelId,
      userId,
      startedAt,
    }: RubyJobData<'utterances'>,
    text: string,
  ) {
    const guildHistory = this.history.get(guildId) ?? [];
    // A retried job (e.g. Convex failed after this ran) transcribes the same utterance again.
    if (guildHistory.some((utterance) => utterance.id === utteranceId)) return;

    const channel = this.client.channels.cache.get(channelId);
    const utterance: FeedUtterance = {
      id: utteranceId,
      guildId,
      channelId,
      channelName: channel && 'name' in channel ? channel.name : null,
      speaker: await this.speakerProfiles.get(guildId, userId),
      text,
      startedAt,
    };

    guildHistory.push(utterance);
    if (guildHistory.length > RUBY_FEED_HISTORY_SIZE) guildHistory.shift();
    this.history.set(guildId, guildHistory);
    this.added.next(utterance);
  }

  getHistory(guildIds: Iterable<string>): FeedUtterance[] {
    return [...guildIds].flatMap((guildId) => this.history.get(guildId) ?? []);
  }

  /** The servers ruby is in that this Discord user is also a member of. */
  async getGuildsForUser(userId: string): Promise<FeedGuild[]> {
    const guilds = [...this.client.guilds.cache.values()];
    const memberships = await Promise.all(
      guilds.map(async (guild) => {
        try {
          // force: without the GuildMembers intent ruby never hears about members leaving,
          // so the member cache can't be trusted for access checks.
          await guild.members.fetch({ user: userId, force: true });
          return true;
        } catch (error) {
          if (
            error instanceof DiscordAPIError &&
            error.code === RESTJSONErrorCodes.UnknownMember
          ) {
            return false;
          }
          this.logger.warn(
            `[${guild.id}] couldn't check membership of ${userId}: ${errorMessage(error)}`,
          );
          return false;
        }
      }),
    );

    return guilds
      .filter((_, index) => memberships[index])
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ size: 64 }),
      }));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
