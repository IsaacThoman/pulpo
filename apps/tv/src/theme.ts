import { useColorScheme } from 'react-native'
import { themePalettes, type AppTheme } from '@/themePalettes'

export type TVTheme = AppTheme & {
  /** Surface of a focused control: tvOS lifts focus to the inverse of the background. */
  focus: string
  focusText: string
  card: string
}

export function tvTheme(dark: boolean): TVTheme {
  const palette = dark ? themePalettes.dark : themePalettes.light
  return {
    ...palette,
    background: dark ? '#0B0B0D' : '#F2F2F5',
    card: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    focus: dark ? '#FFFFFF' : '#111114',
    focusText: dark ? '#09090A' : '#FFFFFF',
  }
}

export function useTVTheme(): TVTheme {
  return tvTheme(useColorScheme() !== 'light')
}

/** tvOS lays out at 1920×1080 points; keep content inside the overscan-safe area. */
export const SAFE = { horizontal: 90, vertical: 60 } as const

export const type = {
  hero: 64,
  title: 44,
  body: 32,
  label: 28,
  caption: 24,
} as const

export const CARD = { width: 420, height: 236 } as const
