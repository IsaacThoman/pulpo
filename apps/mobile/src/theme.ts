import { platformTheme } from './platform/materialTheme';
import { useColorScheme } from 'react-native'
import { usePreferencesStore } from './store/preferences'
import { themePalettes, type AppTheme } from './themePalettes'

export type { AppTheme } from './themePalettes'

export function useAppTheme(): AppTheme {
  const system = useColorScheme()
  const preference = usePreferencesStore((state) => state.theme)
  const scheme = preference === 'system' ? system : preference
  return platformTheme(scheme !== 'light')
}

export { themePalettes }
