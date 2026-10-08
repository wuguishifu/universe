export function createUtteranceS3Key(utteranceId: string) {
  return `utterances/${utteranceId}.wav`;
}
