/**
 * The names in `ffmpeg -encoders` or `ffmpeg -filters` output. Each entry is a line of flags, the
 * name and a description (` V....D h264_videotoolbox  VideoToolbox H.264 Encoder`), so the name is
 * a line's second word. Header lines (` V..... = Video`) give `=`, which no real name is.
 */
export function listedNames(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split('\n')) {
    const name = line.trim().split(/\s+/)[1];
    if (name && name !== '=') names.add(name);
  }
  return names;
}
