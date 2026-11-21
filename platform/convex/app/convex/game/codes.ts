import type { QueryCtx } from '../_generated/server';

/** No 0/O or 1/I, so codes survive being read aloud across a noisy room. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const MAX_ATTEMPTS = 20;

export function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export async function generateUniqueCode(ctx: QueryCtx): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomCode();
    const existing = await ctx.db
      .query('gameParties')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique();
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique party code');
}
