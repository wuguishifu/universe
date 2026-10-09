import { createHash } from 'crypto';

export function createUtteranceS3Key(utteranceId: string) {
  return `utterances/${utteranceId}.wav`;
}

/** One compilation per phrase, e.g. compilations/<sessionId>/i-dont-know.ogg for "I don't know". */
export function createCompilationS3Key(sessionId: string, phrase: string) {
  return `compilations/${sessionId}/${phraseSlug(phrase)}.ogg`;
}

/**
 * Lowercase letters, digits and single hyphens only, so the key never needs escaping (some S3
 * servers store an escaped key as written and then can't find it). Phrases with none of those
 * (e.g. only emoji) get a hash instead.
 */
export function phraseSlug(phrase: string): string {
  const slug = phrase
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['‘’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return (
    slug ||
    `phrase-${createHash('sha256').update(phrase).digest('hex').slice(0, 12)}`
  );
}
