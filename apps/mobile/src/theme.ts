import { platformTheme } from './platform/materialTheme';
import { useIncreaseContrast } from './platform/increaseContrast'
import { useColorScheme } from 'react-native'
import { usePreferencesStore } from './store/preferences'
import { themePalettes, type AppTheme } from './themePalettes'

export type { AppTheme } from './themePalettes'

export function useAppTheme(): AppTheme {
  const system = useColorScheme()
  const preference = usePreferencesStore((state) => state.theme)
  const scheme = preference === 'system' ? system : preference
  const highContrast = useIncreaseContrast()
  return platformTheme(scheme !== 'light', highContrast)
}

export { themePalettes }
