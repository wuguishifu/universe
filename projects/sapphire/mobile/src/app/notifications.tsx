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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@platform/convex-contracts';

import { env } from '../modules/env';
import {
  type PushRegistration,
  usePushRegistration,
} from '../modules/notifications/push-registration';
import { useColors } from '../modules/theme';

export default function NotificationsScreen() {
  const colors = useColors();
  const { registration, register } = usePushRegistration();

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          style={[styles.sectionTitle, { color: colors.muted, marginTop: 0 }]}
        >
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
    </SafeAreaView>
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
          <Text style={[styles.small, { color: colors.muted }]}>
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
  small: {
    fontSize: 13,
  },
  button: {
    paddingVertical: 8,
  },
});
