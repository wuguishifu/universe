export type StreamType = 'primary' | 'secondary' | 'extra' | 'other' | 'all';

export const detectStreamType = (streamName: string): StreamType => {
  const formatted = streamName.toLowerCase();
  if (formatted.match(/^(mic|microphone)$/)) return 'primary';
  if (formatted.match(/^(discord)$/)) return 'secondary';
  if (formatted.match(/^game$/)) return 'extra';
  if (formatted.match(/^medalencoder$/)) return 'other';
  if (formatted.match(/^all audio$/)) return 'all';

  // newer stream will have game title if it's game stream
  return 'extra';
};

export type FFprobeStream = {
  index: number;
  name: string;
  type: StreamType;
};
