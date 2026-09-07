import { useColorScheme } from 'react-native';

const palette = {
  light: {
    bg: '#FBFBFD',
    card: '#FFFFFF',
    border: '#E4E4E9',
    text: '#12121A',
    muted: '#6C6C7A',
    accent: '#4C5FD5',
    accentSoft: '#EDEFFC',
    success: '#1E9E62',
    warning: '#B7791F',
    warningSoft: '#FDF6E7',
    danger: '#C8412F',
  },
  dark: {
    bg: '#0E0E13',
    card: '#1A1A22',
    border: '#2A2A35',
    text: '#F2F2F7',
    muted: '#9A9AAB',
    accent: '#7C8CF8',
    accentSoft: '#1E2140',
    success: '#4ADE9B',
    warning: '#E3B341',
    warningSoft: '#2A2413',
    danger: '#F87171',
  },
};

export type Theme = typeof palette.light;

export const useTheme = (): Theme =>
  useColorScheme() === 'dark' ? palette.dark : palette.light;
