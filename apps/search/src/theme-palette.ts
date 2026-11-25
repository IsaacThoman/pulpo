import { DEFAULT_COLOR_THEME_ID } from '@pulpo/contracts'
import { findColorTheme, resolvePalette } from '../../web/src/lib/color-themes'
import { contrastRatio, flattenHex, mostReadable } from '../../web/src/lib/color'
import type { SearchAppearance } from './api'

export function searchPalette(account: SearchAppearance | undefined, scheme: 'light' | 'dark') {
  if (!account || account.colorTheme === DEFAULT_COLOR_THEME_ID) return {}
  const theme = findColorTheme(account.colorTheme, account.customTheme ? [account.customTheme] : [], account.instanceTheme ? [account.instanceTheme] : [])
  if (theme.id === DEFAULT_COLOR_THEME_ID) return {}
  const colors = resolvePalette(theme[scheme], scheme)
  const secondary = flattenHex(colors.mutedText, colors.background)
  const link = contrastRatio(colors.action, colors.background) >= 4.5 ? colors.action : colors.text
  return {
    '--page': colors.background,
    '--surface': colors.surface,
    '--subtle': colors.raisedSurface,
    '--hover': colors.hover,
    '--line': colors.border,
    '--ink': colors.text,
    '--muted': contrastRatio(secondary, colors.background) >= 4.5 ? secondary : colors.text,
    '--faint': contrastRatio(secondary, colors.background) >= 4.5 ? secondary : colors.text,
    '--accent': colors.action,
    '--accent-ink': contrastRatio(colors.actionText, colors.action) >= 4.5
      ? colors.actionText : mostReadable(colors.action, ['#000000', '#ffffff']),
    '--accent-outline': colors.focus,
    '--link': link,
    '--link-visited': contrastRatio(secondary, colors.background) >= 4.5 ? secondary : link,
    '--error': colors.error,
  }
}
