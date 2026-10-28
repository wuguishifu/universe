import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Star } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as SapphireVault from '@projects/sapphire-vault';

import { useColors } from '../../modules/theme';
import { Button, Toast, useToast, vaultStyles } from '../../modules/vault/ui';
import { useVault } from '../../modules/vault/vault-provider';

const MATCH_LABELS: Record<SapphireVault.UriMatch, string> = {
  0: 'Base domain',
  1: 'Host',
  2: 'Starts with',
  3: 'Exact',
  4: 'Regular expression',
  5: 'Never',
};

export default function VaultItemScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items } = useVault();
  const toast = useToast();

  // Revealed secrets live only in this screen's state: gone when it unmounts or the vault locks.
  const [secret, setSecret] = useState<SapphireVault.VaultItemSecret>();
  const [revealing, setRevealing] = useState(false);

  const item = items?.find((i) => i.id === id);
  if (!item) {
    // Locked (or the item disappeared in a sync).
    return <Redirect href="/vault" />;
  }

  const username = item.username;
  const reveal = async () => {
    setRevealing(true);
    try {
      setSecret(await SapphireVault.reveal(item.id));
    } catch (error) {
      const code = SapphireVault.errorCode(error);
      if (code !== SapphireVault.VaultErrorCode.UserCanceled) {
        toast.show(SapphireVault.errorMessage(error));
      }
    } finally {
      setRevealing(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={vaultStyles.content}>
        <View style={vaultStyles.row}>
          <Text
            style={[vaultStyles.title, { color: colors.text, flexShrink: 1 }]}
          >
            {item.name}
          </Text>
          {item.favorite && (
            <Star size={18} color={colors.muted} fill={colors.muted} />
          )}
        </View>

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          LOGIN
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <Field
            label="Username"
            value={item.username ?? '—'}
            onCopy={
              username
                ? () => toast.run(() => SapphireVault.copy(username))
                : undefined
            }
          />
          <Divider />
          <Field
            label="Password"
            value={secret ? (secret.password ?? '—') : '••••••••••••'}
            mono={!!secret?.password}
            // Before revealing, copying goes through Face ID natively; after, it's already here.
            onCopy={() =>
              toast.run(() =>
                secret?.password
                  ? SapphireVault.copy(secret.password)
                  : SapphireVault.copyPassword(item.id),
              )
            }
          />
          {item.hasTotp && (
            <>
              <Divider />
              {secret?.totp ? (
                <TotpField
                  value={secret.totp}
                  onCopy={(code) => toast.run(() => SapphireVault.copy(code))}
                />
              ) : (
                <Field
                  label="One-time code"
                  value="••• •••"
                  onCopy={() =>
                    toast.run(() => SapphireVault.copyTotp(item.id))
                  }
                />
              )}
            </>
          )}
          {!secret &&
            (revealing ? (
              <ActivityIndicator
                style={{ alignSelf: 'flex-start', marginTop: 8 }}
              />
            ) : (
              <Button label="Reveal" onPress={reveal} />
            ))}
        </View>

        {item.uris.length > 0 && (
          <>
            <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
              WEBSITES
            </Text>
            <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
              {item.uris.map((uri, i) => (
                <View key={i}>
                  {i > 0 && <Divider />}
                  <Field
                    label={MATCH_LABELS[uri.match ?? 0]}
                    value={uri.uri}
                    onPress={
                      /^https?:\/\//i.test(uri.uri)
                        ? () =>
                            router.push({
                              pathname: '/browse',
                              params: { url: uri.uri },
                            })
                        : undefined
                    }
                    onCopy={() => toast.run(() => SapphireVault.copy(uri.uri))}
                  />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <Toast message={toast.message} />
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  mono,
  onPress,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onPress?: () => void;
  onCopy?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[vaultStyles.row, { paddingVertical: 6 }]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={{ flex: 1, gap: 2 }}
      >
        <Text style={[vaultStyles.small, { color: colors.muted }]}>
          {label}
        </Text>
        <Text
          selectable={!onPress}
          style={[
            { color: onPress ? colors.accent : colors.text },
            mono && vaultStyles.mono,
          ]}
        >
          {value}
        </Text>
      </Pressable>
      {onCopy && <Button label="Copy" onPress={onCopy} />}
    </View>
  );
}

function TotpField({
  value,
  onCopy,
}: {
  value: string;
  onCopy: (code: string) => void;
}) {
  const [code, setCode] = useState(() => safeTotp(value));

  useEffect(() => {
    const interval = setInterval(() => setCode(safeTotp(value)), 1000);
    return () => clearInterval(interval);
  }, [value]);

  if (!code) {
    return <Field label="One-time code" value="Invalid TOTP secret" />;
  }
  const grouped =
    code.code.length === 6
      ? `${code.code.slice(0, 3)} ${code.code.slice(3)}`
      : code.code;
  return (
    <Field
      label={`One-time code · ${code.remaining}s`}
      value={grouped}
      mono
      onCopy={() => onCopy(code.code)}
    />
  );
}

function safeTotp(value: string) {
  try {
    return SapphireVault.totp(value);
  } catch {
    return undefined;
  }
}

function Divider() {
  const colors = useColors();
  return <View style={[vaultStyles.divider, { borderColor: colors.border }]} />;
}
