import { createHash } from 'crypto';

/**
 * The format of the utterance files core writes (createUtteranceS3Key): 16-bit mono PCM after a
 * fixed header, so the audio from any time in an utterance is a byte range that can be read on its
 * own.
 */
export const UTTERANCE_WAV = {
  sampleRate: 16_000,
  channels: 1,
  bytesPerSample: 2,
  headerBytes: 44,
} as const;

/**
 * Filed under the session like its compilations, e.g.
 * utterances/2026-10-13T21-04-05Z-<sessionId>/2026-10-13T21-30-12Z-<utteranceId>.wav for an
 * utterance started at 21:30:12 in a session started at 21:04:05 (UTC), so both list in order.
 */
export function createUtteranceS3Key({
  sessionId,
  sessionStartedAt,
  utteranceId,
  utteranceStartedAt,
}: {
  sessionId: string;
  sessionStartedAt: number;
  utteranceId: string;
  utteranceStartedAt: number;
}) {
  return `utterances/${sessionFolder(sessionId, sessionStartedAt)}/${s3Timestamp(utteranceStartedAt)}-${utteranceId}.wav`;
}

/**
 * Where utterances went before they were filed by session, and still go when the session's start
 * time isn't known (sessions the gateway stored before it recorded start times).
 */
export function createLegacyUtteranceS3Key(utteranceId: string) {
  return `utterances/${utteranceId}.wav`;
}

/**
 * One compilation per phrase, e.g. compilations/2026-10-13T21-04-05Z-<sessionId>/i-dont-know-<hash>.ogg
 * for "I don't know" in a session that started at 21:04:05 UTC.
 */
export function createCompilationS3Key(
  sessionId: string,
  sessionTime: number,
  phrase: string,
) {
  return `compilations/${sessionFolder(sessionId, sessionTime)}/${phraseSlug(phrase)}.ogg`;
}

/**
 * The time comes first so sessions list in order; the session ID keeps sessions that started in
 * the same second apart.
 */
function sessionFolder(sessionId: string, sessionTime: number): string {
  return `${s3Timestamp(sessionTime)}-${sessionId}`;
}

/** UTC to the second, without colons, which some S3 tools escape. */
function s3Timestamp(epochMs: number): string {
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'phrase'}-${createHash('sha256').update(phrase).digest('hex').slice(0, 12)}`;
}
