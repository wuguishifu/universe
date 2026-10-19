import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Track } from '@projects/youtube-music-contracts';
import { useDownloadState } from '../lib/downloads';
import { colors } from '../theme';

/** Where a track is: still on its way to the server, being saved to the phone, or saved. */
export function DownloadBadge({ track }: { track: Track }) {
  const state = useDownloadState(track.id);

  if (track.status === 'queued' || track.status === 'downloading') {
    return <ActivityIndicator size="small" color={colors.textMuted} />;
  }
  if (track.status === 'failed') {
    return <Ionicons name="alert-circle" size={18} color={colors.danger} />;
  }
  switch (state?.status) {
    case 'downloaded':
      return (
        <Ionicons name="arrow-down-circle" size={18} color={colors.accent} />
      );
    case 'queued':
      return (
        <Ionicons name="time-outline" size={18} color={colors.textMuted} />
      );
    case 'downloading':
      return (
        <View style={styles.progress}>
          <Text style={styles.progressText}>
            {Math.round(state.progress * 100)}%
          </Text>
        </View>
      );
    case 'failed':
      return <Ionicons name="cloud-offline" size={18} color={colors.danger} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  progress: { minWidth: 34, alignItems: 'flex-end' },
  progressText: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
