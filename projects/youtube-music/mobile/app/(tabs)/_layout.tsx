import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { MiniPlayer } from '../../src/components/mini-player';
import { colors } from '../../src/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Tab colors are typed as any ColorValue, but they're always strings here. */
const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: unknown; size: number }) => (
    <Ionicons
      name={name}
      size={size}
      color={typeof color === 'string' ? color : colors.textMuted}
    />
  );

export default function TabsLayout() {
  return (
    <Tabs
      // The mini player is part of the tab bar, so screens end above it rather than behind it.
      tabBar={(props) => (
        <View style={{ backgroundColor: colors.background }}>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: tabIcon('musical-notes'),
        }}
      />
      <Tabs.Screen
        name="playlists"
        options={{
          title: 'Playlists',
          tabBarIcon: tabIcon('list'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: tabIcon('settings-outline'),
        }}
      />
    </Tabs>
  );
}
