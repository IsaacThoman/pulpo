import { useCallback, useState } from 'react'

/**
 * The notebook editor's view preferences (line numbers, wrapping, the outline), kept per browser.
 * They never go into the document: they are how this person reads it, not what it says.
 */
export const NOTEBOOK_PREFERENCES = {
  lineNumbers: 'pulpo:notebook:line-numbers',
  wrap: 'pulpo:notebook:wrap',
  outline: 'pulpo:notebook:outline',
} as const

function read(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
    return fallback
  }
}

function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // The choice still applies until the page closes.
  }
}

/** A remembered on/off preference. */
export function useStoredFlag(key: string, fallback = false): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => read(key, fallback))
  const set = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      write(key, resolved)
      return resolved
    })
  }, [key])
  return [value, set]
}
