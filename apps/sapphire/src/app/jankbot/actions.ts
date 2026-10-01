'use server';

import { currentUser } from '@clerk/nextjs/server';
import {
  RUBY_FEED_SOCKET_PATH,
  signFeedTicket,
} from '@universe/contracts-ruby';

const rubyBaseUrl = process.env.RUBY_BASE_URL ?? 'https://ruby.wuguishifu.dev';

export type FeedConnectionResult =
  | { success: true; url: string }
  | { success: false; error: string };

/**
 * A socket URL for ruby's live feed, carrying a short-lived ticket for the signed-in user's
 * Discord account. Ruby decides which servers they can see.
 */
export async function getFeedConnection(): Promise<FeedConnectionResult> {
  const user = await currentUser();
  if (!user) return { success: false, error: 'sign in to see transcripts' };

  // Clerk reports the provider as `oauth_discord`.
  const discordAccount = user.externalAccounts.find((account) =>
    account.provider.endsWith('discord'),
  );
  if (!discordAccount) {
    return {
      success: false,
      error: 'connect a discord account to see transcripts',
    };
  }

  const secret = process.env.RUBY_FEED_SECRET;
  if (!secret) return { success: false, error: 'live feed is not configured' };

  const ticket = await signFeedTicket(discordAccount.providerUserId, secret);
  const url = new URL(RUBY_FEED_SOCKET_PATH, rubyBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return { success: true, url: url.toString() };
}
