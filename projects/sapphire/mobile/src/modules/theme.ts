import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { useColorScheme } from 'react-native';

export function useColors() {
  return useColorScheme() === 'dark' ? darkColors : lightColors;
}

/**
 * Theme for the navigators, so their own surfaces (screen backgrounds shown
 * during transitions, headers) follow the device instead of defaulting to
 * light.
 */
export function useNavigationTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const colors = dark ? darkColors : lightColors;

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  };
}

const lightColors = {
  background: '#f2f2f7',
  card: '#ffffff',
  text: '#000000',
  muted: '#6e6e73',
  border: '#d1d1d6',
  accent: '#007aff',
  danger: '#ff3b30',
  success: '#34c759',
};

const darkColors: typeof lightColors = {
  background: '#000000',
  card: '#1c1c1e',
  text: '#ffffff',
  muted: '#98989f',
  border: '#38383a',
  accent: '#0a84ff',
  danger: '#ff453a',
  success: '#30d158',
};
