import { useQuery } from 'convex/react';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { api } from '@platform/convex-contracts';

import { ConvexClientProvider } from '../modules/convex/convex-client-provider';
import { env } from '../modules/env';
import { PushRegistrationProvider } from '../modules/notifications/push-registration';
import { useNotificationRouting } from '../modules/notifications/use-notification-routing';
import { TailnetProvider } from '../modules/tailnet/tailnet-provider';

// Without a handler, notifications that arrive while the app is open aren't shown.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

export default function RootLayout() {
  return (
    <ConvexClientProvider>
      <TailnetProvider>
        <Root />
      </TailnetProvider>
    </ConvexClientProvider>
  );
}

function Root() {
  const channels = useQuery(api.notifications.channels.list, {
    deviceSecret: env.deviceSecret,
  });
  useNotificationRouting();

  return (
    <PushRegistrationProvider channels={channels}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="tailnet" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="browse" />
      </Stack>
    </PushRegistrationProvider>
  );
}
