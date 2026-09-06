import { platformTheme } from '../../platform/materialTheme';
import { useColorScheme } from 'react-native';
import { themePalettes, type AppTheme } from '../../themePalettes';
import { usePrototypeStore } from './store/prototypeStore';

export type { AppTheme } from '../../themePalettes';

export function useAppTheme(): AppTheme {
  const system = useColorScheme();
  const preference = usePrototypeStore((state) => state.preferences.theme);
  const scheme = preference === 'system' ? system : preference;
  return platformTheme(scheme !== 'light');
}

export { themePalettes };
