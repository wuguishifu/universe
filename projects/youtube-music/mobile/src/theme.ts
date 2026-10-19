import { DarkTheme, type Theme } from 'expo-router';

export const colors = {
  background: '#0b0b0f',
  surface: '#16161d',
  surfaceRaised: '#20202a',
  border: '#2a2a35',
  text: '#f4f4f6',
  textMuted: '#9a9aa8',
  textFaint: '#6b6b78',
  accent: '#ff4d6d',
  accentMuted: '#ff4d6d33',
  danger: '#ff5a5a',
  success: '#4ade80',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
  },
};
