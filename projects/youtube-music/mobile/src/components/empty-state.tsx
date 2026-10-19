import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.textFaint} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: 64,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  message: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
});
