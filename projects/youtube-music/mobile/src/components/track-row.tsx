import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track } from '@projects/youtube-music-contracts';
import { formatDuration, trackArtist, trackTitle } from '../lib/format';
import { colors, spacing } from '../theme';
import { Artwork } from './artwork';
import { DownloadBadge } from './download-badge';

function statusLine(track: Track): string {
  switch (track.status) {
    case 'queued':
      return track.error
        ? 'Waiting to retry on the server'
        : 'Queued on the server';
    case 'downloading':
      return 'Downloading on the server…';
    case 'failed':
      return track.error ?? 'Download failed';
    case 'ready':
      return `${trackArtist(track)} · ${formatDuration(track.durationSec)}`;
  }
}

export const TrackRow = memo(function TrackRow({
  track,
  playing,
  onPress,
  onMore,
  accessory,
}: {
  track: Track;
  /** It's the current track. */
  playing?: boolean;
  onPress: () => void;
  onMore: () => void;
  /** Replaces the menu button, e.g. for reordering. */
  accessory?: React.ReactNode;
}) {
  const ready = track.status === 'ready';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Artwork track={track} size={48} />
      <View style={styles.text}>
        <Text
          style={[
            styles.title,
            playing && styles.playing,
            !ready && styles.dim,
          ]}
          numberOfLines={1}
        >
          {trackTitle(track)}
        </Text>
        <Text
          style={[styles.subtitle, track.status === 'failed' && styles.error]}
          numberOfLines={1}
        >
          {statusLine(track)}
        </Text>
      </View>
      <DownloadBadge track={track} />
      {accessory ?? (
        <Pressable onPress={onMore} hitSlop={12} style={styles.more}>
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={colors.textMuted}
          />
        </Pressable>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.surface },
  text: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  playing: { color: colors.accent },
  dim: { color: colors.textMuted },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.danger },
  more: { padding: spacing.xs },
});
