import { useColorScheme } from 'react-native'
import { usePreferencesStore } from './store/preferences'
import { darkTheme, lightTheme, themePalettes, type AppTheme } from './themePalettes'

export type { AppTheme } from './themePalettes'

export function useAppTheme(): AppTheme {
  const system = useColorScheme()
  const preference = usePreferencesStore((state) => state.theme)
  const scheme = preference === 'system' ? system : preference
  return scheme === 'light' ? lightTheme : darkTheme
}

export { themePalettes }
