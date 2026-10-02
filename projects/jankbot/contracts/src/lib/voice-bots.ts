import { z } from 'zod';

/**
 * jankbot runs one gateway per Discord bot ("voice bot"), since a bot can only be in one voice
 * channel per guild. Each has a display name (NAME in its gateway, listed in core's VOICE_BOTS).
 * Everything keyed by a bot uses this form of the name, so "Bo" and "bo" are the same bot.
 */
export function voiceBotId(name: string): string {
  return name.trim().toLowerCase();
}

/** A gateway's voice bot is online while this is in Redis; it refreshes it more often than it expires. */
export const VOICE_BOT_HEARTBEAT_TTL_SECONDS = 30;
export const VOICE_BOT_HEARTBEAT_INTERVAL_MS = 10_000;

export const voiceBotHeartbeatSchema = z.object({
  name: z.string(),
  /** The bot's Discord user ID. */
  userId: z.string(),
});
export type VoiceBotHeartbeat = z.infer<typeof voiceBotHeartbeatSchema>;

/**
 * core → one gateway: join or leave a voice channel. Each voice bot has its own queue, since BullMQ
 * can't route a job to a particular worker. core waits for the result to reply to the command.
 */
export const VOICE_COMMANDS = {
  queueName: (botName: string) => `voice-commands-${voiceBotId(botName)}`,
  jobName: 'voice-command',
  jobSchema: z.object({
    /**
     * Epoch ms after which core has stopped waiting. A gateway that was down when the command was
     * sent skips it on startup instead of joining a channel nobody asked about anymore.
     */
    expiresAt: z.number(),
    guildId: z.string(),
    command: z.discriminatedUnion('action', [
      z.object({ action: z.literal('join'), channelId: z.string() }),
      z.object({ action: z.literal('leave') }),
    ]),
  }),
  resultSchema: z.discriminatedUnion('status', [
    z.object({ status: z.literal('joined') }),
    z.object({ status: z.literal('left') }),
    /** /leave: the bot wasn't connected in that guild. */
    z.object({ status: z.literal('not-connected') }),
    /** /join: the channel is gone, isn't a voice channel, or the bot lacks permission to join. */
    z.object({ status: z.literal('channel-unavailable') }),
    /** /join: connecting failed or timed out. */
    z.object({ status: z.literal('connect-failed') }),
    /** The command expired before the gateway got to it. */
    z.object({ status: z.literal('expired') }),
  ]),
};

export type VoiceCommandJobData = z.infer<typeof VOICE_COMMANDS.jobSchema>;
export type VoiceCommandResult = z.infer<typeof VOICE_COMMANDS.resultSchema>;
