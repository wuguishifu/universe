import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ConvexClientProvider } from '../modules/convex/convex-client-provider';
import { TailnetProvider } from '../modules/tailnet/tailnet-provider';

export default function RootLayout() {
  return (
    <ConvexClientProvider>
      <TailnetProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="tailnet" />
          <Stack.Screen name="browse" />
        </Stack>
      </TailnetProvider>
    </ConvexClientProvider>
  );
}
