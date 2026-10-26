import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { TailnetProvider } from '../modules/tailnet/tailnet-provider';

export default function RootLayout() {
  return (
    <TailnetProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="browse" options={{ title: '' }} />
      </Stack>
    </TailnetProvider>
  );
}
