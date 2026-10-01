import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'discord.js';
import type { FeedSpeaker } from '@universe/contracts-ruby';

/** Long enough that a busy channel barely touches the Discord API, short enough to pick up renames. */
const PROFILE_TTL_MS = 10 * 60 * 1000;

/**
 * Per-server display names and avatars for the feed, cached in memory. Server profiles win
 * over global ones, matching what people see in Discord.
 */
@Injectable()
export class SpeakerProfilesService {
  private readonly logger = new Logger(SpeakerProfilesService.name);
  private readonly cache = new Map<
    string,
    { profile: FeedSpeaker; expiresAt: number }
  >();

  constructor(private readonly client: Client) {}

  async get(guildId: string, userId: string): Promise<FeedSpeaker> {
    const key = `${guildId}:${userId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;

    const profile = await this.fetch(guildId, userId);
    this.cache.set(key, { profile, expiresAt: Date.now() + PROFILE_TTL_MS });
    return profile;
  }

  private async fetch(guildId: string, userId: string): Promise<FeedSpeaker> {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch({ user: userId, force: true });
      return {
        id: userId,
        displayName: member.displayName,
        avatarUrl: member.displayAvatarURL({ size: 64 }),
      };
    } catch (error) {
      // Probably left the server since speaking; their global profile is the next best thing.
      this.logger.debug(
        `[${guildId}] ${userId}: no member profile: ${errorMessage(error)}`,
      );
    }

    const user = await this.client.users.fetch(userId);
    return {
      id: userId,
      displayName: user.displayName,
      avatarUrl: user.displayAvatarURL({ size: 64 }),
    };
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
