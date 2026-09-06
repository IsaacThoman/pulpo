import { getMaterialColors } from '@expo/ui/jetpack-compose';
import type { AppTheme } from '../themePalettes';
export function platformTheme(isDark: boolean): AppTheme {
  const c = getMaterialColors({ scheme: isDark ? 'dark' : 'light' });
  // Remove the opaque alpha suffix so existing tint-opacity helpers remain valid.
  const hex = (value: string) => value.length === 9 && value.endsWith('FF') ? value.slice(0, 7) : value;
  return {
    isDark, background: hex(c.surface), elevated: hex(c.surfaceContainerLow), elevated2: hex(c.surfaceContainerHigh), glass: hex(c.surfaceContainerLow),
    text: hex(c.onSurface), secondary: hex(c.onSurfaceVariant), tertiary: hex(c.outline), separator: hex(c.outlineVariant),
    accent: hex(c.primary), accentText: hex(c.onPrimary), blue: hex(c.primary), green: hex(c.tertiary), orange: hex(c.tertiary), red: hex(c.error),
    disabledBackground: hex(c.surfaceContainerHighest), disabledText: hex(c.onSurfaceVariant), fill: hex(c.surfaceContainer), fillStrong: hex(c.secondaryContainer), shadow: '#000000',
  };
}
