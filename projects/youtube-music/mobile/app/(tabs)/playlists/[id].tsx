import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Artwork } from '../../../src/components/artwork';
import { Button } from '../../../src/components/button';
import { EmptyState } from '../../../src/components/empty-state';
import { PromptModal } from '../../../src/components/prompt-modal';
import { TrackRow } from '../../../src/components/track-row';
import { confirm, showActionSheet } from '../../../src/lib/action-sheet';
import { useConnection } from '../../../src/lib/api';
import { downloads } from '../../../src/lib/downloads';
import { describeTracks } from '../../../src/lib/format';
import { player, useCurrentTrack } from '../../../src/lib/player';
import {
  useDeletePlaylist,
  usePlaylist,
  useRenamePlaylist,
  useSetPlaylistTracks,
  useSyncPlaylist,
  useTracksById,
} from '../../../src/lib/queries';
import { useTrackActions } from '../../../src/lib/track-actions';
import { colors, spacing } from '../../../src/theme';

export default function PlaylistScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlist = usePlaylist(Number(id));
  const tracksById = useTracksById();
  const connection = useConnection();
  const current = useCurrentTrack();
  const openActions = useTrackActions();
  const renamePlaylist = useRenamePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const setTracks = useSetPlaylistTracks();
  const syncPlaylist = useSyncPlaylist();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const tracks = useMemo(
    () =>
      (playlist?.trackIds ?? []).flatMap((trackId) => {
        const track = tracksById.get(trackId);
        return track ? [track] : [];
      }),
    [playlist, tracksById],
  );
  const playable = tracks.filter((t) => t.status === 'ready');

  if (!playlist) {
    return (
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="list" title="This playlist is gone" />
      </ScrollView>
    );
  }

  /** Moves a track up (-1) or down (1). By ID, since `tracks` skips any the library lacks. */
  const move = (trackId: number, by: -1 | 1) => {
    const ids = [...playlist.trackIds];
    const from = ids.indexOf(trackId);
    const to = from + by;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, trackId);
    setTracks.mutate({ id: playlist.id, trackIds: ids });
  };

  const openMenu = () =>
    showActionSheet(playlist.name, [
      { label: 'Edit order', onPress: () => setEditing(true) },
      { label: 'Rename', onPress: () => setRenaming(true) },
      {
        label: 'Download to phone',
        onPress: () => downloads.download(tracks, connection),
      },
      {
        label: 'Remove downloads',
        onPress: () => tracks.forEach((t) => downloads.remove(t.id)),
      },
      ...(playlist.youtubePlaylistId
        ? [
            {
              label: 'Sync with YouTube',
              onPress: () =>
                syncPlaylist.mutate(playlist.id, {
                  onSuccess: ({ queued }) =>
                    Alert.alert(
                      'Synced',
                      queued
                        ? `${queued} new ${queued === 1 ? 'song is' : 'songs are'} downloading.`
                        : "It's up to date.",
                    ),
                }),
            },
          ]
        : []),
      {
        label: 'Delete playlist',
        destructive: true,
        onPress: () =>
          confirm(
            `Delete “${playlist.name}”?`,
            'The songs stay in your library.',
            'Delete',
            () => {
              deletePlaylist.mutate(playlist.id);
              router.back();
            },
          ),
      },
    ]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: playlist.name,
          headerLargeTitleEnabled: false,
          headerRight: () =>
            editing ? (
              <Pressable onPress={() => setEditing(false)} hitSlop={10}>
                <Text style={styles.done}>Done</Text>
              </Pressable>
            ) : (
              <Pressable onPress={openMenu} hitSlop={10}>
                <Ionicons
                  name="ellipsis-horizontal-circle"
                  size={26}
                  color={colors.accent}
                />
              </Pressable>
            ),
        }}
      />
      <FlatList
        data={tracks}
        keyExtractor={(t) => String(t.id)}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View style={styles.header}>
            <Artwork
              track={tracks.find((t) => t.hasArtwork)}
              size={180}
              radius={10}
            />
            <Text style={styles.name}>{playlist.name}</Text>
            <Text style={styles.meta}>
              {playlist.youtubePlaylistId ? 'From YouTube · ' : ''}
              {describeTracks(tracks)}
            </Text>
            {playable.length > 0 && !editing && (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button
                    label="Play"
                    icon="play"
                    onPress={() =>
                      void player.play(playable, 0, {
                        shuffle: false,
                        context: playlist.name,
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
                        { shuffle: true, context: playlist.name },
                      )
                    }
                  />
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="musical-notes-outline"
            title="Nothing in here yet"
            message="Add songs from your library with their … menu."
          />
        }
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            playing={item.id === current?.id}
            onPress={() =>
              item.status === 'ready'
                ? void player.play(tracks, index, { context: playlist.name })
                : openActions(item, { playlist })
            }
            onMore={() => openActions(item, { playlist })}
            accessory={
              editing ? (
                <View style={styles.reorder}>
                  <Pressable
                    hitSlop={6}
                    disabled={index === 0}
                    onPress={() => move(item.id, -1)}
                  >
                    <Ionicons
                      name="chevron-up"
                      size={22}
                      color={index === 0 ? colors.border : colors.text}
                    />
                  </Pressable>
                  <Pressable
                    hitSlop={6}
                    disabled={index === tracks.length - 1}
                    onPress={() => move(item.id, 1)}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={22}
                      color={
                        index === tracks.length - 1
                          ? colors.border
                          : colors.text
                      }
                    />
                  </Pressable>
                  <Pressable
                    hitSlop={6}
                    onPress={() =>
                      setTracks.mutate({
                        id: playlist.id,
                        trackIds: playlist.trackIds.filter(
                          (trackId) => trackId !== item.id,
                        ),
                      })
                    }
                  >
                    <Ionicons
                      name="remove-circle"
                      size={22}
                      color={colors.danger}
                    />
                  </Pressable>
                </View>
              ) : undefined
            }
          />
        )}
      />
      <PromptModal
        visible={renaming}
        title="Rename playlist"
        initialValue={playlist.name}
        submitLabel="Save"
        onCancel={() => setRenaming(false)}
        onSubmit={(name) => {
          setRenaming(false);
          renamePlaylist.mutate({ id: playlist.id, name });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  meta: { color: colors.textMuted, fontSize: 14 },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    alignSelf: 'stretch',
  },
  action: { flex: 1 },
  done: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  reorder: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
