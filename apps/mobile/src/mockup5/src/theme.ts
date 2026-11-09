import { platformTheme } from '../../platform/materialTheme';
import { useIncreaseContrast } from '../../platform/increaseContrast';
import { useColorScheme } from 'react-native';
import { themePalettes, type AppTheme } from '../../themePalettes';
import { usePrototypeStore } from './store/prototypeStore';

export type { AppTheme } from '../../themePalettes';

export function useAppTheme(): AppTheme {
  const system = useColorScheme();
  const preference = usePrototypeStore((state) => state.preferences.theme);
  const scheme = preference === 'system' ? system : preference;
  const highContrast = useIncreaseContrast();
  return platformTheme(scheme !== 'light', highContrast);
}

export { themePalettes };
