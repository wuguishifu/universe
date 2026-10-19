import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, ThemeProvider } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { BackgroundSync } from '../src/components/background-sync';
import {
  PERSIST_MAX_AGE_MS,
  queryClient,
  queryPersister,
} from '../src/lib/queries';
import { SettingsProvider } from '../src/lib/settings';
import { colors, navigationTheme } from '../src/theme';

/** So a modal opened straight from a share still has the tabs underneath. */
export const unstable_settings = { initialRouteName: '(tabs)' };

const modalHeader = {
  presentation: 'modal',
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  contentStyle: { backgroundColor: colors.surface },
} as const;

export default function RootLayout() {
  return (
    // expo-share-intent wants to be outside every other provider.
    <ShareIntentProvider>
      <SettingsProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: PERSIST_MAX_AGE_MS,
          }}
        >
          <ThemeProvider value={navigationTheme}>
            <StatusBar style="light" />
            <BackgroundSync />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="player" options={{ presentation: 'modal' }} />
              <Stack.Screen
                name="add"
                options={{ ...modalHeader, title: 'Add from YouTube' }}
              />
              <Stack.Screen
                name="edit/[id]"
                options={{ ...modalHeader, title: 'Edit info' }}
              />
              <Stack.Screen
                name="add-to-playlist"
                options={{ ...modalHeader, title: 'Add to playlist' }}
              />
            </Stack>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SettingsProvider>
    </ShareIntentProvider>
  );
}
