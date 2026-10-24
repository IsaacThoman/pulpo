import { PixelRatio, Platform } from 'react-native'
import type { AppTheme } from '../../../theme'
import type { EditorTheme } from './protocol'

export function editorTheme(theme: AppTheme, bottomPadding = 0): EditorTheme {
  return {
    dark: theme.isDark,
    background: theme.isDark ? theme.background : theme.elevated,
    foreground: theme.text,
    muted: theme.fillStrong,
    mutedForeground: theme.secondary,
    border: theme.separator,
    primary: theme.blue,
    code: theme.isDark ? theme.elevated : theme.elevated2,
    codeForeground: theme.text,
    fontSize: Math.round(17 * Math.min(PixelRatio.getFontScale(), 2.2)),
    bottomPadding,
  }
}

/** A link as typed: bare domains get https, other schemes stay as they are. */
export function normalizeHref(value: string): string {
  const href = value.trim()
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  return `https://${href}`
}

/** How other sessions label this device's caret. */
export function deviceSessionLabel(): string {
  if (Platform.OS === 'android') return 'Pulpo on Android'
  return Platform.OS === 'ios' && Platform.isPad ? 'Pulpo on iPad' : 'Pulpo on iPhone'
}
