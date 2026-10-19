import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Artwork } from '../../../src/components/artwork';
import { EmptyState } from '../../../src/components/empty-state';
import { PromptModal } from '../../../src/components/prompt-modal';
import { describeTracks } from '../../../src/lib/format';
import {
  useCreatePlaylist,
  usePlaylists,
  useTracksById,
} from '../../../src/lib/queries';
import { colors, spacing } from '../../../src/theme';

export default function PlaylistsScreen() {
  const router = useRouter();
  const { data, isPending, isRefetching, refetch } = usePlaylists();
  const tracksById = useTracksById();
  const createPlaylist = useCreatePlaylist();
  const [creating, setCreating] = useState(false);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Playlists',
          headerRight: () => (
            <Pressable onPress={() => setCreating(true)} hitSlop={10}>
              <Ionicons name="add" size={28} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={data ?? []}
        keyExtractor={(p) => String(p.id)}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.textMuted}
          />
        }
        ListEmptyComponent={
          isPending ? undefined : (
            <EmptyState
              icon="list"
              title="No playlists yet"
              message="Tap + to make one, or share a YouTube playlist to Tunes to import it."
            />
          )
        }
        renderItem={({ item }) => {
          const tracks = item.trackIds.flatMap((id) => {
            const track = tracksById.get(id);
            return track ? [track] : [];
          });
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/playlists/[id]',
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Artwork track={tracks.find((t) => t.hasArtwork)} size={56} />
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.youtubePlaylistId ? 'From YouTube · ' : ''}
                  {describeTracks(tracks)}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textFaint}
              />
            </Pressable>
          );
        }}
      />
      <PromptModal
        visible={creating}
        title="New playlist"
        placeholder="Name"
        submitLabel="Create"
        onCancel={() => setCreating(false)}
        onSubmit={(name) => {
          setCreating(false);
          createPlaylist.mutate(name, {
            onSuccess: (playlist) =>
              router.push({
                pathname: '/playlists/[id]',
                params: { id: playlist.id },
              }),
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.surface },
  text: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 13 },
});
