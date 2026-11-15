import { useQuery } from 'convex/react';
import * as Notifications from 'expo-notifications';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';

import { api } from '@platform/convex-contracts';

import { ConvexClientProvider } from '../modules/convex/convex-client-provider';
import { env } from '../modules/env';
import { PushRegistrationProvider } from '../modules/notifications/push-registration';
import { useNotificationRouting } from '../modules/notifications/use-notification-routing';
import { TailnetProvider } from '../modules/tailnet/tailnet-provider';
import { useColors, useNavigationTheme } from '../modules/theme';
import { VaultProvider } from '../modules/vault/vault-provider';

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
        <VaultProvider>
          <Root />
        </VaultProvider>
      </TailnetProvider>
    </ConvexClientProvider>
  );
}

function Root() {
  const channels = useQuery(api.notifications.channels.list, {
    deviceSecret: env.deviceSecret,
  });
  useNotificationRouting();

  const colors = useColors();
  const theme = useNavigationTheme();

  // The root view sits behind every screen and shows through before the first
  // render and wherever a screen doesn't cover it (e.g. mid swipe-back).
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <PushRegistrationProvider channels={channels}>
      <ThemeProvider value={theme}>
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
          <Stack.Screen name="vault" />
          <Stack.Screen name="ssh" />
        </Stack>
      </ThemeProvider>
    </PushRegistrationProvider>
  );
}
