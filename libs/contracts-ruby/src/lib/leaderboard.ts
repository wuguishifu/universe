import { z } from 'zod';
import { feedGuildSchema } from './feed';

/**
 * Ruby's HTTP endpoint that turns a feed ticket (`Authorization: Bearer <ticket>`) into the
 * servers the viewer can see and a grant for reading their leaderboards from hydrogen.
 */
export const RUBY_LEADERBOARD_ACCESS_PATH = '/api/leaderboard/access';

/** How many speakers each phrase's leaderboard shows. */
export const RUBY_LEADERBOARD_SIZE = 10;

const leaderboardAccessSchema = z.object({
  guilds: z.array(feedGuildSchema),
  /** Pass to hydrogen's `ruby.leaderboard.forViewer`. */
  grant: z.string(),
  /** Epoch ms. Get a new grant before then. */
  expiresAt: z.number(),
});

export type LeaderboardAccess = z.infer<typeof leaderboardAccessSchema>;

/** Returns null for anything that isn't a valid access response. */
export function parseLeaderboardAccess(data: unknown): LeaderboardAccess | null {
  const result = leaderboardAccessSchema.safeParse(data);
  return result.success ? result.data : null;
}
