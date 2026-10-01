import { z } from 'zod';

/** Path of ruby's live feed WebSocket. Connect with `?ticket=<signed ticket>`. */
export const RUBY_FEED_SOCKET_PATH = '/api/feed';

/** How many utterances ruby keeps in memory per server. */
export const RUBY_FEED_HISTORY_SIZE = 100;

const feedGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
});

const feedSpeakerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string(),
});

const feedUtteranceSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  channelId: z.string(),
  channelName: z.string().nullable(),
  speaker: feedSpeakerSchema,
  text: z.string(),
  /** Epoch ms when the speaker started talking. */
  startedAt: z.number(),
});

/** Messages ruby sends over the feed socket. The client never sends anything. */
const feedServerMessageSchema = z.discriminatedUnion('type', [
  /** Sent once on connect: the servers this user can see, and their buffered history. */
  z.object({
    type: z.literal('ready'),
    guilds: z.array(feedGuildSchema),
    utterances: z.array(feedUtteranceSchema),
  }),
  z.object({ type: z.literal('utterance'), utterance: feedUtteranceSchema }),
]);

export type FeedGuild = z.infer<typeof feedGuildSchema>;
export type FeedSpeaker = z.infer<typeof feedSpeakerSchema>;
export type FeedUtterance = z.infer<typeof feedUtteranceSchema>;
export type FeedServerMessage = z.infer<typeof feedServerMessageSchema>;

/** Returns null for anything that isn't a valid feed message. */
export function parseFeedServerMessage(data: string): FeedServerMessage | null {
  try {
    const result = feedServerMessageSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** WebSocket close codes ruby uses when it rejects a connection. */
export const FEED_CLOSE_CODES = {
  /** Missing, malformed, expired, or wrongly signed ticket. Get a new ticket before retrying. */
  unauthorized: 4401,
} as const;
