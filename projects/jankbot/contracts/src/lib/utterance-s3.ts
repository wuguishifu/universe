export function createUtteranceS3Key(utteranceId: string) {
  return `utterances/${utteranceId}.wav`;
}

/** One compilation per phrase, keyed by the configured phrase as written. */
export function createCompilationS3Key(sessionId: string, phrase: string) {
  return `compilations/${sessionId}/${encodeURIComponent(phrase)}.ogg`;
}
