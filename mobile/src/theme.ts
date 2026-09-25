import { useColorScheme } from 'react-native';

const palette = {
  light: {
    bg: '#F4F5F0',
    card: '#FFFFFF',
    border: '#DFE5DF',
    text: '#202A2A',
    muted: '#65716E',
    accent: '#245D4C',
    accentSoft: '#E8F0E9',
    success: '#28734F',
    warning: '#8A672A',
    warningSoft: '#F4EFDF',
    danger: '#A5453D',
  },
  dark: {
    bg: '#171E1D',
    card: '#222B29',
    border: '#3B4642',
    text: '#EEF3EF',
    muted: '#AAB6B1',
    accent: '#A5D6BD',
    accentSoft: '#293B33',
    success: '#8DC5A4',
    warning: '#D6BD7C',
    warningSoft: '#383320',
    danger: '#E09B91',
  },
};

export type Theme = typeof palette.light;

export const useTheme = (): Theme =>
  useColorScheme() === 'dark' ? palette.dark : palette.light;
