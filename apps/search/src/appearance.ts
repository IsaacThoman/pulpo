import { useEffect, useState } from 'react'
import { api, type SearchAppearance } from './api'
import type { Theme } from './preferences'

const schemeQuery = '(prefers-color-scheme: dark)'

export function searchColorScheme(preference: Theme, account: SearchAppearance | undefined, systemDark: boolean) {
  const mode = preference === 'pulpo' ? account?.theme ?? 'system' : preference
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

export function useSearchAppearance(userId: string | undefined, preference: Theme) {
  const [account, setAccount] = useState<{ id: string; value: SearchAppearance }>()
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(schemeQuery).matches ?? false)

  useEffect(() => {
    const media = window.matchMedia?.(schemeQuery)
    if (!media) return
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!userId) {
      setAccount(undefined)
      return
    }
    let pending: AbortController | undefined
    const refresh = () => {
      pending?.abort()
      const current = new AbortController()
      pending = current
      api.appearance(current.signal).then(value => {
        if (!current.signal.aborted) setAccount({ id: userId, value })
      }).catch(() => {
        // Preserve the last account palette through transient connection errors.
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      pending?.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [userId])

  const appearance = account && account.id === userId ? account.value : undefined
  useEffect(() => {
    const root = document.documentElement
    const scheme = searchColorScheme(preference, appearance, systemDark)
    root.dataset.theme = scheme
    let cancelled = false
    let applied: string[] = []
    if (appearance && appearance.colorTheme !== 'pulpo') {
      void import('./theme-palette').then(({ searchPalette }) => {
        if (cancelled) return
        const colors = Object.entries(searchPalette(appearance, scheme))
        applied = colors.map(([name]) => name)
        for (const [name, color] of colors) root.style.setProperty(name, color)
      }).catch(() => {
        // The default Search palette remains usable if the theme chunk cannot load.
      })
    }
    return () => {
      cancelled = true
      for (const name of applied) root.style.removeProperty(name)
      delete root.dataset.theme
    }
  }, [appearance, preference, systemDark])
}
