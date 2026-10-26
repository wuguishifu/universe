import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as SapphireProxy from '../../modules/sapphire-proxy';
import { useTailnet } from '../modules/tailnet/tailnet-provider';
import { useColors } from '../modules/theme';

export default function HomeScreen() {
  const colors = useColors();
  const tailnet = useTailnet();
  const [url, setUrl] = useState('http://');
  const [showLogs, setShowLogs] = useState(false);

  const status = tailnet.phase === 'started' ? tailnet.status : undefined;
  const running = status?.backendState === 'Running';
  const peers = [...(status?.peers ?? [])].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      a.hostName.localeCompare(b.hostName),
  );

  const open = (target: string) =>
    router.push({ pathname: '/browse', params: { url: target } });

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          TAILNET
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <NodeStatus />
        </View>

        {running && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              OPEN
            </Text>
            <View
              style={[
                styles.card,
                styles.row,
                { backgroundColor: colors.card },
              ]}
            >
              <TextInput
                value={url}
                onChangeText={setUrl}
                onSubmitEditing={() => open(url)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                placeholder="http://sol:8080"
                placeholderTextColor={colors.muted}
                style={[styles.input, { color: colors.text }]}
              />
              <Button label="Go" onPress={() => open(url)} />
            </View>

            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              PEERS
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              {peers.map((peer, i) => (
                <Pressable
                  key={peer.dnsName || peer.hostName}
                  onPress={() =>
                    setUrl(`http://${peer.dnsName || peer.hostName}`)
                  }
                  style={[
                    styles.peer,
                    i > 0 && [styles.divider, { borderColor: colors.border }],
                  ]}
                >
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: peer.online
                          ? colors.success
                          : colors.border,
                      },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text }}>{peer.hostName}</Text>
                    <Text style={[styles.small, { color: colors.muted }]}>
                      {peer.ips[0]} · {peer.os}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Button
          label={showLogs ? 'Hide logs' : 'Show logs'}
          onPress={() => setShowLogs((s) => !s)}
        />
        {showLogs && <Logs />}
      </ScrollView>
    </SafeAreaView>
  );
}

function NodeStatus() {
  const colors = useColors();
  const tailnet = useTailnet();

  if (tailnet.phase === 'error') {
    return (
      <Text style={{ color: colors.danger }}>
        Couldn't start: {tailnet.message}
      </Text>
    );
  }
  if (tailnet.phase === 'starting' || !tailnet.status) {
    return <ActivityIndicator />;
  }

  const { status, proxyPort } = tailnet;
  const { authURL } = status;
  return (
    <>
      <Text style={{ color: colors.text }}>{status.backendState}</Text>
      {status.self?.dnsName && (
        <Text selectable style={[styles.small, { color: colors.muted }]}>
          {status.self.dnsName} · {status.self.ips.join(', ')}
        </Text>
      )}
      <Text style={[styles.small, { color: colors.muted }]}>
        proxy on 127.0.0.1:{proxyPort}
      </Text>

      {authURL ? (
        <Button
          label="Log in to Tailscale"
          onPress={() => WebBrowser.openBrowserAsync(authURL)}
        />
      ) : null}
      {status.backendState === 'Running' && (
        <Button label="Log out" onPress={() => SapphireProxy.logout()} />
      )}
    </>
  );
}

function Logs() {
  const colors = useColors();
  const [logs, setLogs] = useState(() => SapphireProxy.logs());

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Button label="Refresh" onPress={() => setLogs(SapphireProxy.logs())} />
      <Text selectable style={[styles.logs, { color: colors.muted }]}>
        {logs.split('\n').slice(-150).join('\n')}
      </Text>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={{ color: colors.accent }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    marginTop: 16,
    marginLeft: 16,
  },
  card: {
    borderRadius: 10,
    padding: 16,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  peer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  small: {
    fontSize: 13,
  },
  logs: {
    fontFamily: 'Menlo',
    fontSize: 10,
  },
  button: {
    paddingVertical: 8,
  },
});
