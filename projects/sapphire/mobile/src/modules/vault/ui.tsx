import * as Burnt from 'burnt';
import { Pressable, StyleSheet, Text } from 'react-native';

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
 * Runs a copy action and confirms it with a native toast. A canceled Face ID prompt shows
 * nothing; any other failure shows its message.
 */
export async function copyWithToast(action: () => Promise<void>) {
  try {
    await action();
    Burnt.toast({
      title: 'Copied',
      message: 'Clears in 60s',
      preset: 'done',
      haptic: 'success',
      duration: 2,
    });
  } catch (error) {
    const code = SapphireVault.errorCode(error);
    if (
      code !== SapphireVault.VaultErrorCode.UserCanceled &&
      code !== SapphireVault.VaultErrorCode.AuthenticationFailed
    ) {
      showError("Couldn't copy", error);
    }
  }
}

/**
 * Shows a failure as a native alert rather than a toast: the toast truncates to one line,
 * and vault errors can be long.
 */
export function showError(title: string, error: unknown) {
  Burnt.alert({
    title,
    message: SapphireVault.errorMessage(error),
    preset: 'error',
    duration: 3,
  });
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
});
