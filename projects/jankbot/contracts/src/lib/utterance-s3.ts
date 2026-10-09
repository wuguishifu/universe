import { createHash } from 'crypto';

/**
 * The format of utterances/<utteranceId>.wav, which core writes: 16-bit mono PCM after a fixed
 * header, so the audio from any time in an utterance is a byte range that can be read on its own.
 */
export const UTTERANCE_WAV = {
  sampleRate: 16_000,
  channels: 1,
  bytesPerSample: 2,
  headerBytes: 44,
} as const;

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
