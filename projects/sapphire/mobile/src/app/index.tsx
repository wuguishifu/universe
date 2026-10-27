import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@platform/convex-contracts';

import { usePushRegistration } from '../modules/notifications/push-registration';
import { useTailnet } from '../modules/tailnet/tailnet-provider';
import { useColors } from '../modules/theme';

const COLUMNS = 3;
const PADDING = 16;
const GAP = 8;

export default function DashboardScreen() {
  const colors = useColors();
  const items = useQuery(api.sapphire.dashboard.list);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <TailnetRow />
        <NotificationsRow />
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
            {chunk(
              [...items].sort((a, b) => a.name.localeCompare(b.name)),
              COLUMNS,
            ).map((row) => (
              <View key={row[0]?._id} style={styles.gridRow}>
                {row.map((item) => (
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
                {/* Keep a short last row's tiles the same size as the rest. */}
                {Array.from({ length: COLUMNS - row.length }, (_, i) => (
                  <View key={i} style={styles.tileSpacer} />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

function TailnetRow() {
  const tailnet = useTailnet();

  const state =
    tailnet.phase === 'error'
      ? 'Error'
      : tailnet.phase === 'started' && tailnet.status
        ? tailnet.status.backendState
        : 'Starting';

  return (
    <StatusRow
      label={`Tailnet · ${state === 'NeedsLogin' ? 'Tap to log in' : state}`}
      health={
        state === 'Running' ? 'ok' : state === 'Error' ? 'error' : 'neutral'
      }
      onPress={() => router.push('/tailnet')}
    />
  );
}

function NotificationsRow() {
  const { registration } = usePushRegistration();

  const { state, health } = (
    {
      pending: { state: 'Registering', health: 'neutral' },
      unsupported: { state: 'Unsupported', health: 'neutral' },
      denied: { state: 'Off', health: 'error' },
      error: { state: 'Error', health: 'error' },
      registered: { state: 'On', health: 'ok' },
    } as const
  )[registration.status];

  return (
    <StatusRow
      label={`Notifications · ${state}`}
      health={health}
      onPress={() => router.push('/notifications')}
    />
  );
}

function StatusRow({
  label,
  health,
  onPress,
}: {
  label: string;
  health: 'ok' | 'error' | 'neutral';
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, styles.row, { backgroundColor: colors.card }]}
    >
      <View
        style={[
          styles.dot,
          {
            backgroundColor:
              health === 'ok'
                ? colors.success
                : health === 'error'
                  ? colors.danger
                  : colors.border,
          },
        ]}
      />
      <Text style={{ flex: 1, color: colors.text }}>{label}</Text>
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
    gap: GAP,
  },
  gridRow: {
    flexDirection: 'row',
    gap: GAP,
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileSpacer: {
    flex: 1,
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
