'use server';

import { currentUser } from '@clerk/nextjs/server';
import {
  type LeaderboardAccess,
  parseLeaderboardAccess,
  RUBY_FEED_SOCKET_PATH,
  RUBY_LEADERBOARD_ACCESS_PATH,
  signFeedTicket,
} from '@universe/contracts-ruby';

const rubyBaseUrl = process.env.RUBY_BASE_URL ?? 'https://ruby.wuguishifu.dev';

type Result<T> = ({ success: true } & T) | { success: false; error: string };

export type FeedConnectionResult = Result<{ url: string }>;
export type LeaderboardAccessResult = Result<{ access: LeaderboardAccess }>;

/**
 * A socket URL for ruby's live feed, carrying a short-lived ticket for the signed-in user's
 * Discord account. Ruby decides which servers they can see.
 */
export async function getFeedConnection(): Promise<FeedConnectionResult> {
  const ticket = await getViewerTicket('transcripts');
  if (!ticket.success) return ticket;

  const url = new URL(RUBY_FEED_SOCKET_PATH, rubyBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket.ticket);
  return { success: true, url: url.toString() };
}

/**
 * The servers the signed-in user can see and a grant for reading their leaderboards from
 * hydrogen. Ruby checks membership and signs the grant.
 */
export async function getLeaderboardAccess(): Promise<LeaderboardAccessResult> {
  const ticket = await getViewerTicket('leaderboards');
  if (!ticket.success) return ticket;

  const response = await fetch(
    new URL(RUBY_LEADERBOARD_ACCESS_PATH, rubyBaseUrl),
    {
      headers: { authorization: `Bearer ${ticket.ticket}` },
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    // Thrown rather than returned, so the client retries.
    throw new Error(`ruby responded ${response.status}`);
  }
  const access = parseLeaderboardAccess(await response.json());
  if (!access) throw new Error('ruby sent an invalid leaderboard access response');
  return { success: true, access };
}

/** A short-lived ticket for the signed-in user's Discord account. */
async function getViewerTicket(what: string): Promise<Result<{ ticket: string }>> {
  const user = await currentUser();
  if (!user) return { success: false, error: `sign in to see ${what}` };

  // Clerk reports the provider as `oauth_discord`.
  const discordAccount = user.externalAccounts.find((account) =>
    account.provider.endsWith('discord'),
  );
  if (!discordAccount) {
    return {
      success: false,
      error: `connect a discord account to see ${what}`,
    };
  }

  const secret = process.env.RUBY_FEED_SECRET;
  if (!secret) return { success: false, error: 'live feed is not configured' };

  const ticket = await signFeedTicket(discordAccount.providerUserId, secret);
  return { success: true, ticket };
}
