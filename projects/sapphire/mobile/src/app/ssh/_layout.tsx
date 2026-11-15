import { Redirect, Stack } from 'expo-router';

import * as SapphireSsh from '@projects/sapphire-ssh';

export default function SshLayout() {
  if (!SapphireSsh.isAvailable) {
    return <Redirect href="/" />;
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* A stray edge swipe would end the session. */}
      <Stack.Screen name="session" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
