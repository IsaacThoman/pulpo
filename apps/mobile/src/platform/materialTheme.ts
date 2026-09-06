import { darkTheme, lightTheme, type AppTheme } from '../themePalettes';
export function platformTheme(isDark: boolean): AppTheme { return isDark ? darkTheme : lightTheme; }
