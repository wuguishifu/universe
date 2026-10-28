import { router } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '../../modules/theme';
import { Button, vaultStyles } from '../../modules/vault/ui';
import { formatAgo, useVault } from '../../modules/vault/vault-provider';

export default function VaultSettingsScreen() {
  const colors = useColors();
  const { state, sync, items, syncNow, lock, logout } = useVault();

  // Logged out, the vault screen sends you to the login form.
  const logOutThen = (title: string, message: string, action: string) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.dismissTo('/vault');
        },
      },
    ]);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={vaultStyles.content}>
        <Text style={[vaultStyles.title, { color: colors.text }]}>
          Vault settings
        </Text>

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          ACCOUNT
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.text }}>{state?.email ?? '—'}</Text>
          <Text selectable style={[vaultStyles.small, { color: colors.muted }]}>
            {state?.serverUrl}
          </Text>
          <Button
            label="Change server…"
            onPress={() =>
              logOutThen(
                'Change server?',
                'This logs out of the vault on this device. You can log in to the new server next.',
                'Log out',
              )
            }
          />
        </View>

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          SYNC
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.text }}>
            {sync.status === 'syncing'
              ? 'Syncing…'
              : state?.lastSync
                ? `Last synced ${formatAgo(state.lastSync)}`
                : 'Not synced yet'}
          </Text>
          {sync.status === 'error' && (
            <Text style={[vaultStyles.small, { color: colors.danger }]}>
              {sync.message}
            </Text>
          )}
          <Button
            label="Sync now"
            onPress={() => void syncNow()}
            disabled={sync.status === 'syncing'}
          />
        </View>

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          SECURITY
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <Text style={[vaultStyles.small, { color: colors.muted }]}>
            The vault locks 5 minutes after Sapphire goes to the background.
            Copying or revealing a password always asks for Face ID.
          </Text>
          <Button
            label="Lock now"
            disabled={!items}
            onPress={() => {
              lock();
              router.dismissTo('/vault');
            }}
          />
          <Button
            label="Log out"
            tone="danger"
            onPress={() =>
              logOutThen(
                'Log out of the vault?',
                'This removes the vault key, the cached vault, and the AutoFill suggestions from this device.',
                'Log out',
              )
            }
          />
        </View>

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          AUTOFILL
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <Text style={[vaultStyles.small, { color: colors.muted }]}>
            Turn on Sapphire in Settings → General → AutoFill & Passwords. Its
            suggestions update each time you unlock the vault here.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
