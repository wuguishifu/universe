export function watchUrl(youtubeId: string) {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

export function s3Key(youtubeId: string) {
  return `${youtubeId}.mp3`;
}
