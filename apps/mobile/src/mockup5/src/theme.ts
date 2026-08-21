import { Platform, useColorScheme } from 'react-native';
import { androidDarkTheme, androidLightTheme, darkTheme, lightTheme, themePalettes, type AppTheme } from '../../themePalettes';
import { usePrototypeStore } from './store/prototypeStore';

export type { AppTheme } from '../../themePalettes';

export function useAppTheme(): AppTheme {
  const system = useColorScheme();
  const preference = usePrototypeStore((state) => state.preferences.theme);
  const scheme = preference === 'system' ? system : preference;
  if (Platform.OS === 'android') return scheme === 'light' ? androidLightTheme : androidDarkTheme;
  return scheme === 'light' ? lightTheme : darkTheme;
}

export { themePalettes };
