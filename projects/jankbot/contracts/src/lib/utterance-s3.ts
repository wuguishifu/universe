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

/**
 * One compilation per phrase, e.g. compilations/2026-10-13T21-04-05Z-<sessionId>/i-dont-know-<hash>.ogg
 * for "I don't know" in a session that started at 21:04:05 UTC. The time comes first so sessions
 * list in order; the session ID keeps sessions that started in the same second apart.
 */
export function createCompilationS3Key(
  sessionId: string,
  sessionTime: number,
  phrase: string,
) {
  return `compilations/${compilationTimestamp(sessionTime)}-${sessionId}/${phraseSlug(phrase)}.ogg`;
}

/** UTC to the second, without colons, which some S3 tools escape. */
function compilationTimestamp(epochMs: number): string {
  return new Date(epochMs)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
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
  return `${slug || 'phrase'}-${createHash('sha256').update(phrase).digest('hex').slice(0, 12)}`;
}
