export function extractYoutubeId(
  inputUrl: string,
  onError: (error: unknown) => void,
) {
  try {
    const url = new URL(inputUrl);
    return url.searchParams.get('v');
  } catch (error) {
    onError(error);
    return null;
  }
}

export function s3Key(youtubeId: string) {
  return `${youtubeId}.mp3`;
}
