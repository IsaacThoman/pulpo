import { useCallback, useState } from 'react'

/**
 * View preferences of the live editors (line numbers, wrapping, zoom), kept per browser. They
 * never go into the document: they are how this person reads it, not what it says. Storage can
 * be unavailable (private windows, blocked site data); the choice then lasts until the page closes.
 */

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice still applies until the page closes.
  }
}

type Update<T> = T | ((current: T) => T)

function useStored<T>(key: string, parse: (stored: string | null) => T, format: (value: T) => string): [T, (next: Update<T>) => void] {
  const [value, setValue] = useState(() => parse(read(key)))
  const set = useCallback((next: Update<T>) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next
      write(key, format(resolved))
      return resolved
    })
  }, [key, format])
  return [value, set]
}

const formatFlag = (value: boolean) => String(value)

/** A remembered on/off preference. */
export function useStoredFlag(key: string, fallback = false): [boolean, (next: Update<boolean>) => void] {
  const parse = useCallback((stored: string | null) => (stored === null ? fallback : stored === 'true'), [fallback])
  return useStored(key, parse, formatFlag)
}

/** A remembered number, kept within bounds (a stored value out of them, or not a number, gives `fallback`). */
export function useStoredNumber(key: string, fallback: number, min: number, max: number): [number, (next: Update<number>) => void] {
  const parse = useCallback((stored: string | null) => {
    const value = stored === null ? NaN : Number(stored)
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback
  }, [fallback, min, max])
  const format = useCallback((value: number) => String(value), [])
  return useStored(key, parse, format)
}
