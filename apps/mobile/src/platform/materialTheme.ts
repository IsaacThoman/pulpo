import { darkTheme, highContrastDarkTheme, highContrastLightTheme, lightTheme, type AppTheme } from '../themePalettes';
export function platformTheme(isDark: boolean, highContrast = false): AppTheme {
  if (highContrast) return isDark ? highContrastDarkTheme : highContrastLightTheme;
  return isDark ? darkTheme : lightTheme;
}
