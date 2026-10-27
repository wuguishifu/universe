import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@platform/convex-contracts';

import { useTailnet } from '../modules/tailnet/tailnet-provider';
import { useColors } from '../modules/theme';

const COLUMNS = 3;
const PADDING = 16;
const GAP = 8;

export default function DashboardScreen() {
  const colors = useColors();
  const items = useQuery(api.sapphire.dashboard.list);
  const { width } = useWindowDimensions();
  const tileSize = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <TailnetRow />
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          SERVICES
        </Text>
        {items === undefined ? (
          <ActivityIndicator style={styles.placeholder} />
        ) : items.length === 0 ? (
          <Text style={[styles.placeholder, { color: colors.muted }]}>
            Nothing here yet
          </Text>
        ) : (
          <View style={styles.grid}>
            {[...items]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((item) => (
                <Pressable
                  key={item._id}
                  onPress={() =>
                    router.push({
                      pathname: '/browse',
                      params: { url: item.url },
                    })
                  }
                  style={({ pressed }) => [
                    styles.tile,
                    {
                      width: tileSize,
                      height: tileSize,
                      backgroundColor: colors.card,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Image source={{ uri: item.iconUrl }} style={styles.icon} />
                  <Text
                    numberOfLines={2}
                    style={[styles.name, { color: colors.text }]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TailnetRow() {
  const colors = useColors();
  const tailnet = useTailnet();

  const state =
    tailnet.phase === 'error'
      ? 'Error'
      : tailnet.phase === 'started' && tailnet.status
        ? tailnet.status.backendState
        : 'Starting';
  const running = state === 'Running';

  return (
    <Pressable
      onPress={() => router.push('/tailnet')}
      style={[styles.card, styles.row, { backgroundColor: colors.card }]}
    >
      <View
        style={[
          styles.dot,
          {
            backgroundColor: running
              ? colors.success
              : state === 'Error'
                ? colors.danger
                : colors.border,
          },
        ]}
      />
      <Text style={{ flex: 1, color: colors.text }}>
        Tailnet · {state === 'NeedsLogin' ? 'Tap to log in' : state}
      </Text>
      <Text style={{ color: colors.muted }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: PADDING,
    gap: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    marginTop: 16,
    marginLeft: 16,
  },
  card: {
    borderRadius: 10,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  placeholder: {
    marginTop: 24,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  icon: {
    width: 48,
    height: 48,
    resizeMode: 'contain',
  },
  name: {
    fontSize: 13,
    textAlign: 'center',
  },
});
