import { Redirect, Stack } from 'expo-router';

import * as SapphireVault from '@projects/sapphire-vault';

export default function VaultLayout() {
  if (!SapphireVault.isAvailable) {
    return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
