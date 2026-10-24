import { useMutation, useQuery } from 'convex/react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
} from 'react-native';

import { api } from '@platform/convex-contracts';

import { env } from '../modules/env';
import {
  type PushRegistration,
  usePushRegistration,
} from '../modules/notifications/push-registration';

export default function HomeScreen() {
  const colors = useColors();
  const { registration, register } = usePushRegistration();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={[styles.sectionTitle, { color: colors.muted }]}>
        THIS DEVICE
      </Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <RegistrationStatus registration={registration} onRetry={register} />
      </View>

      {registration.status === 'registered' && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            CHANNELS
          </Text>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Channels expoPushToken={registration.expoPushToken} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function RegistrationStatus({
  registration,
  onRetry,
}: {
  registration: PushRegistration;
  onRetry: () => void;
}) {
  const colors = useColors();

  switch (registration.status) {
    case 'pending':
      return <ActivityIndicator />;
    case 'unsupported':
      return (
        <Text style={{ color: colors.text }}>
          Push notifications need a physical device.
        </Text>
      );
    case 'denied':
      return (
        <>
          <Text style={{ color: colors.text }}>
            Notifications are turned off for this app.
          </Text>
          <Button
            label="Open Settings"
            onPress={() => Linking.openSettings()}
          />
        </>
      );
    case 'error':
      return (
        <>
          <Text style={{ color: colors.danger }}>
            Couldn't register: {registration.message}
          </Text>
          <Button label="Try again" onPress={onRetry} />
        </>
      );
    case 'registered':
      return (
        <>
          <Text style={{ color: colors.text }}>Registered</Text>
          <Text selectable style={[styles.token, { color: colors.muted }]}>
            {registration.expoPushToken}
          </Text>
        </>
      );
  }
}

function Channels({ expoPushToken }: { expoPushToken: string }) {
  const colors = useColors();
  const deviceSecret = env.deviceSecret;
  const channels = useQuery(api.notifications.channels.list, { deviceSecret });
  const device = useQuery(api.notifications.devices.get, {
    deviceSecret,
    expoPushToken,
  });
  const setMutedChannels = useMutation(
    api.notifications.devices.setMutedChannels,
  ).withOptimisticUpdate((store, { mutedChannels }) => {
    const args = { deviceSecret, expoPushToken };
    const current = store.getQuery(api.notifications.devices.get, args);
    if (current) {
      store.setQuery(api.notifications.devices.get, args, {
        ...current,
        mutedChannels,
      });
    }
  });

  if (!channels || !device) {
    return <ActivityIndicator />;
  }

  return channels.map((channel, i) => {
    const muted = device.mutedChannels.includes(channel.id);
    return (
      <View
        key={channel.id}
        style={[
          styles.channel,
          i > 0 && [styles.divider, { borderColor: colors.border }],
        ]}
      >
        <View style={styles.channelText}>
          <Text style={{ color: colors.text }}>{channel.label}</Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            {channel.description}
          </Text>
        </View>
        <Switch
          value={!muted}
          onValueChange={async (enabled) => {
            await setMutedChannels({
              deviceSecret,
              expoPushToken,
              mutedChannels: enabled
                ? device.mutedChannels.filter((id) => id !== channel.id)
                : [...device.mutedChannels, channel.id],
            });
          }}
        />
      </View>
    );
  });
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={{ color: colors.accent }}>{label}</Text>
    </Pressable>
  );
}

function useColors() {
  return useColorScheme() === 'dark' ? darkColors : lightColors;
}

const lightColors = {
  background: '#f2f2f7',
  card: '#ffffff',
  text: '#000000',
  muted: '#6e6e73',
  border: '#d1d1d6',
  accent: '#007aff',
  danger: '#ff3b30',
};

const darkColors: typeof lightColors = {
  background: '#000000',
  card: '#1c1c1e',
  text: '#ffffff',
  muted: '#98989f',
  border: '#38383a',
  accent: '#0a84ff',
  danger: '#ff453a',
};

const styles = StyleSheet.create({
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    marginTop: 16,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  card: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  token: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  channelText: {
    flex: 1,
    gap: 2,
  },
  description: {
    fontSize: 13,
  },
  button: {
    paddingVertical: 4,
  },
});
