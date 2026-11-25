import { DEFAULT_COLOR_THEME_ID } from '@pulpo/contracts'
import { findColorTheme, resolvePalette, type ThemePalette } from '../../web/src/lib/color-themes'
import { contrastRatio, flattenHex, mostReadable } from '../../web/src/lib/color'
import type { SearchAppearance } from './api'

type Scheme = 'light' | 'dark'

/** Maps a resolved Pulpo palette to Search's tokens, keeping secondary text and links readable. */
function searchTokens(colors: ThemePalette) {
  const secondary = flattenHex(colors.mutedText, colors.background)
  const readableSecondary = contrastRatio(secondary, colors.background) >= 4.5 ? secondary : colors.text
  return {
    '--page': colors.background,
    '--surface': colors.surface,
    '--subtle': colors.raisedSurface,
    '--hover': colors.hover,
    '--line': flattenHex(colors.border, colors.background),
    '--ink': colors.text,
    '--muted': readableSecondary,
    '--faint': readableSecondary,
    '--accent': colors.action,
    '--accent-ink': contrastRatio(colors.actionText, colors.action) >= 4.5
      ? colors.actionText : mostReadable(colors.action, ['#000000', '#ffffff']),
    '--accent-outline': colors.focus,
    '--error': colors.error,
  }
}

/**
 * Search's built-in colors, from Pulpo's default theme. styles.css carries these values so the first
 * paint needs no script; a test keeps the two in step. Links keep Search's own blue and purple.
 */
export function defaultSearchPalette(scheme: Scheme) {
  const theme = findColorTheme(DEFAULT_COLOR_THEME_ID, [])
  return searchTokens(resolvePalette(theme[scheme], scheme))
}

export function searchPalette(account: SearchAppearance | undefined, scheme: Scheme): Record<string, string> {
  if (!account || account.colorTheme === DEFAULT_COLOR_THEME_ID) return {}
  const theme = findColorTheme(account.colorTheme, account.customTheme ? [account.customTheme] : [], account.instanceTheme ? [account.instanceTheme] : [])
  if (theme.id === DEFAULT_COLOR_THEME_ID) return {}
  const colors = resolvePalette(theme[scheme], scheme)
  const tokens = searchTokens(colors)
  const link = contrastRatio(colors.action, colors.background) >= 4.5 ? colors.action : colors.text
  return {
    ...tokens,
    '--link': link,
    '--link-visited': tokens['--muted'] === colors.text ? link : tokens['--muted'],
  }
}
