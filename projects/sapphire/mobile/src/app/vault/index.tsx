import { Redirect, router } from 'expo-router';
import { Copy, Star } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as SapphireVault from '@projects/sapphire-vault';

import { useColors } from '../../modules/theme';
import {
  Button,
  copyWithToast,
  showError,
  vaultStyles,
} from '../../modules/vault/ui';
import { formatAgo, useVault } from '../../modules/vault/vault-provider';

export default function VaultScreen() {
  const colors = useColors();
  const { state, items } = useVault();

  if (!state) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }
  if (!state.loggedIn || !state.keyAvailable) {
    return <Redirect href="/vault/login" />;
  }
  return items ? <ItemList items={items} /> : <Locked />;
}

function Header() {
  const colors = useColors();
  const { state, sync } = useVault();

  const synced =
    sync.status === 'syncing'
      ? 'Syncing…'
      : state?.lastSync
        ? `Synced ${formatAgo(state.lastSync)}`
        : 'Not synced yet';

  return (
    <View style={{ gap: 8 }}>
      <View style={vaultStyles.row}>
        <Text style={[vaultStyles.title, { flex: 1, color: colors.text }]}>
          Vault
        </Text>
        <Button
          label="Settings"
          onPress={() => router.push('/vault/settings')}
        />
      </View>
      <Text style={[vaultStyles.small, { color: colors.muted }]}>{synced}</Text>
      {sync.status === 'error' && (
        <Text style={[vaultStyles.small, { color: colors.danger }]}>
          Sync failed: {sync.message}
        </Text>
      )}
      {state?.needsReauth && (
        <Pressable
          onPress={() => router.push('/vault/login')}
          style={[vaultStyles.card, { backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.danger }}>
            The session expired, so the vault can't sync. Showing the last copy.
          </Text>
          <Text style={{ color: colors.accent }}>Enter master password ›</Text>
        </Pressable>
      )}
    </View>
  );
}

function Locked() {
  const colors = useColors();
  const { unlock } = useVault();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const tryUnlock = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await unlock();
    } catch (e) {
      setError(SapphireVault.errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Ask for Face ID straight away when the screen opens.
  const prompted = useRef(false);
  useEffect(() => {
    if (!prompted.current) {
      prompted.current = true;
      void tryUnlock();
    }
  });

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={vaultStyles.content}>
        <Header />
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.text }}>Locked</Text>
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}
          {busy ? (
            <ActivityIndicator style={{ alignSelf: 'flex-start' }} />
          ) : (
            <Button label="Unlock with Face ID" onPress={tryUnlock} />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function ItemList({ items }: { items: SapphireVault.VaultItemSummary[] }) {
  const colors = useColors();
  const { syncNow } = useVault();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [items],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) =>
      [item.name, item.username ?? '', ...item.uris.map((u) => u.uri)].some(
        (field) => field.toLowerCase().includes(q),
      ),
    );
  }, [sorted, query]);

  // If the cache changed, the provider locks and the locked screen asks for Face ID.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } catch (error) {
      showError("Couldn't sync", error);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={[vaultStyles.content, { paddingBottom: 8 }]}>
        <Header />
        <View
          style={[
            vaultStyles.card,
            { backgroundColor: colors.card, paddingVertical: 4 },
          ]}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            style={[vaultStyles.input, { color: colors.text }]}
          />
        </View>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.muted }]}>
            {query ? 'No matches' : 'No logins in this vault'}
          </Text>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.item,
              { backgroundColor: colors.card },
              index === 0 && styles.first,
              index === filtered.length - 1 && styles.last,
              index > 0 && [
                vaultStyles.divider,
                { borderColor: colors.border },
              ],
            ]}
          >
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/vault/[id]',
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [
                styles.itemText,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={vaultStyles.row}>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.text, flexShrink: 1 }}
                >
                  {item.name}
                </Text>
                {item.favorite && (
                  <Star size={12} color={colors.muted} fill={colors.muted} />
                )}
              </View>
              {item.username && (
                <Text
                  numberOfLines={1}
                  style={[vaultStyles.small, { color: colors.muted }]}
                >
                  {item.username}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityLabel={`Copy password for ${item.name}`}
              hitSlop={8}
              onPress={() =>
                copyWithToast(() => SapphireVault.copyPassword(item.id))
              }
              style={({ pressed }) => [
                styles.copy,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Copy size={20} color={colors.accent} />
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
  },
  first: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  last: {
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  itemText: {
    flex: 1,
    paddingVertical: 12,
    gap: 2,
  },
  copy: {
    padding: 16,
  },
  empty: {
    marginTop: 24,
    textAlign: 'center',
  },
});
