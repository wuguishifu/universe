import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as SapphireVault from '@projects/sapphire-vault';

import { useColors } from '../theme';

export function Button({
  label,
  onPress,
  disabled,
  tone = 'accent',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger';
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Text
        style={{ color: tone === 'danger' ? colors.danger : colors.accent }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A short-lived message pinned to the bottom of the screen ("Copied"). `run` wraps a copy
 * action: a canceled Face ID prompt shows nothing, any other failure shows its message.
 */
export function useToast() {
  const [message, setMessage] = useState<string>();
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((next: string) => {
    clearTimeout(timeout.current);
    setMessage(next);
    timeout.current = setTimeout(() => setMessage(undefined), 2000);
  }, []);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const run = useCallback(
    async (action: () => Promise<void>, success = 'Copied · clears in 60s') => {
      try {
        await action();
        show(success);
      } catch (error) {
        const code = SapphireVault.errorCode(error);
        if (
          code !== SapphireVault.VaultErrorCode.UserCanceled &&
          code !== SapphireVault.VaultErrorCode.AuthenticationFailed
        ) {
          show(SapphireVault.errorMessage(error));
        }
      }
    },
    [show],
  );

  return { message, show, run };
}

export function Toast({ message }: { message?: string }) {
  const colors = useColors();
  if (!message) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.toastContainer}>
      <View style={[styles.toast, { backgroundColor: colors.text }]}>
        <Text style={{ color: colors.background }}>{message}</Text>
      </View>
    </View>
  );
}

export const vaultStyles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    fontSize: 16,
    paddingVertical: 8,
  },
  small: {
    fontSize: 13,
  },
  mono: {
    fontFamily: 'Menlo',
  },
});

const styles = StyleSheet.create({
  button: {
    paddingVertical: 8,
  },
  toastContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 48,
    alignItems: 'center',
  },
  toast: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
