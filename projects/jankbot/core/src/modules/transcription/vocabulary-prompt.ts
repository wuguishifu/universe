import { MAX_PROMPT_LENGTH } from '@platform/transcription-contracts';

const SEPARATOR = ', ';

/**
 * Whisper's prompt as a comma-separated list of the guild's phrases, so it spells them the way
 * they're tracked. Phrases that would push it past the prompt limit are left out whole.
 * Undefined when there's nothing to prompt with.
 */
export function vocabularyPrompt(phrases: string[]): string | undefined {
  let prompt = '';
  for (const phrase of phrases) {
    const next = prompt ? `${prompt}${SEPARATOR}${phrase}` : phrase;
    if (next.length > MAX_PROMPT_LENGTH) continue;
    prompt = next;
  }
  return prompt || undefined;
}
