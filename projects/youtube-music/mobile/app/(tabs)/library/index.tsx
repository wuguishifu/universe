import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Track } from '@projects/youtube-music-contracts';
import { Button } from '../../../src/components/button';
import { EmptyState } from '../../../src/components/empty-state';
import { TrackRow } from '../../../src/components/track-row';
import { useDownloads } from '../../../src/lib/downloads';
import { describeTracks, sortKey } from '../../../src/lib/format';
import { player, useCurrentTrack } from '../../../src/lib/player';
import { useTracks } from '../../../src/lib/queries';
import { useSettings } from '../../../src/lib/settings';
import { useTrackActions } from '../../../src/lib/track-actions';
import { colors, spacing } from '../../../src/theme';

type Filter = 'all' | 'downloaded' | 'pending';
type Sort = 'recent' | 'title' | 'artist';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'downloaded', label: 'On this phone' },
  { value: 'pending', label: 'Not ready' },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
];

export default function LibraryScreen() {
  const router = useRouter();
  const { configured } = useSettings();
  const { data, isPending, isRefetching, refetch, error } = useTracks();
  const downloadStates = useDownloads();
  const current = useCurrentTrack();
  const openActions = useTrackActions();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');

  const tracks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = (data ?? []).filter((track) => {
      if (
        filter === 'downloaded' &&
        downloadStates.get(track.id)?.status !== 'downloaded'
      ) {
        return false;
      }
      if (filter === 'pending' && track.status === 'ready') return false;
      if (!query) return true;
      return [track.title, track.artist, track.album].some((field) =>
        field?.toLocaleLowerCase().includes(query),
      );
    });
    if (sort === 'title') {
      filtered.sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)));
    } else if (sort === 'artist') {
      filtered.sort(
        (a, b) =>
          sortKey(a.artist).localeCompare(sortKey(b.artist)) ||
          sortKey(a.title).localeCompare(sortKey(b.title)),
      );
    }
    return filtered;
  }, [data, search, filter, sort, downloadStates]);

  const playable = useMemo(
    () => tracks.filter((t) => t.status === 'ready'),
    [tracks],
  );

  const onPress = useCallback(
    (track: Track, index: number) => {
      if (track.status !== 'ready') {
        openActions(track);
        return;
      }
      void player.play(tracks, index, { context: 'Library' });
    },
    [tracks, openActions],
  );

  const header = (
    <Stack.Screen
      options={{
        title: 'Library',
        headerRight: () => (
          <Pressable onPress={() => router.push('/add')} hitSlop={10}>
            <Ionicons name="add" size={28} color={colors.accent} />
          </Pressable>
        ),
        headerSearchBarOptions: {
          placeholder: 'Search your library',
          onChangeText: (e) => setSearch(e.nativeEvent.text),
          hideWhenScrolling: true,
        },
      }}
    />
  );

  if (!configured) {
    return (
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
      >
        {header}
        <EmptyState
          icon="server-outline"
          title="Connect to your server"
          message="Add the address of your youtube-music-service and its API token to get started."
        >
          <Button
            label="Open settings"
            onPress={() => router.navigate('/settings')}
          />
        </EmptyState>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <FlatList
        data={tracks}
        keyExtractor={(track) => String(track.id)}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.chips}>
              {FILTERS.map(({ value, label }) => (
                <Chip
                  key={value}
                  label={label}
                  selected={filter === value}
                  onPress={() => setFilter(value)}
                />
              ))}
              <View style={styles.spacer} />
              <Pressable
                hitSlop={8}
                onPress={() =>
                  setSort(
                    SORTS[
                      (SORTS.findIndex((s) => s.value === sort) + 1) %
                        SORTS.length
                    ]?.value ?? 'recent',
                  )
                }
                style={styles.sort}
              >
                <Ionicons
                  name="swap-vertical"
                  size={14}
                  color={colors.textMuted}
                />
                <Text style={styles.sortText}>
                  {SORTS.find((s) => s.value === sort)?.label}
                </Text>
              </Pressable>
            </View>
            {playable.length > 0 && (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button
                    label="Play"
                    icon="play"
                    onPress={() =>
                      void player.play(playable, 0, {
                        shuffle: false,
                        context: 'Library',
                      })
                    }
                  />
                </View>
                <View style={styles.action}>
                  <Button
                    label="Shuffle"
                    icon="shuffle"
                    variant="secondary"
                    onPress={() =>
                      void player.play(
                        playable,
                        Math.floor(Math.random() * playable.length),
                        { shuffle: true, context: 'Library' },
                      )
                    }
                  />
                </View>
              </View>
            )}
            {tracks.length > 0 && (
              <Text style={styles.count}>{describeTracks(tracks)}</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          isPending ? undefined : error && !data ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't reach the server"
              message={error.message}
            />
          ) : search || filter !== 'all' ? (
            <EmptyState icon="search" title="Nothing matches" />
          ) : (
            <EmptyState
              icon="logo-youtube"
              title="Your library is empty"
              message="Share a YouTube video or playlist to Tunes, or tap + to paste a link."
            />
          )
        }
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            playing={item.id === current?.id}
            onPress={() => onPress(item, index)}
            onMore={() => openActions(item)}
          />
        )}
      />
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
  },
  chipSelected: { backgroundColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  chipTextSelected: { color: colors.text },
  spacer: { flex: 1 },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortText: { color: colors.textMuted, fontSize: 13 },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  action: { flex: 1 },
  count: {
    color: colors.textFaint,
    fontSize: 13,
    paddingHorizontal: spacing.lg,
  },
});
