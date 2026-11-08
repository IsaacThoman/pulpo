import { useState } from 'react'

/**
 * The Word editor's per-person settings (Docs keeps them per account, Word per install): kept in
 * this browser only, and never in the document. Storage may be missing or blocked (private
 * windows, sandboxed previews), so every read and write falls back to the default.
 */
export interface DocxPreferences {
  /** Tools ▸ AutoFormat as you type. */
  autoformat: boolean
  /** View ▸ Show word count: the status bar's live count. */
  wordCount: boolean
}

const KEY = 'pulpo.docx.preferences'
export const DEFAULT_DOCX_PREFERENCES: DocxPreferences = { autoformat: true, wordCount: true }

export function readDocxPreferences(): DocxPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<DocxPreferences> | null
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_DOCX_PREFERENCES }
    return {
      autoformat: typeof stored.autoformat === 'boolean' ? stored.autoformat : DEFAULT_DOCX_PREFERENCES.autoformat,
      wordCount: typeof stored.wordCount === 'boolean' ? stored.wordCount : DEFAULT_DOCX_PREFERENCES.wordCount,
    }
  } catch {
    return { ...DEFAULT_DOCX_PREFERENCES }
  }
}

export function writeDocxPreferences(preferences: DocxPreferences): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(preferences))
  } catch {
    // Not remembered; the setting still applies until the page closes.
  }
}

/** The preferences, read once, with a setter that also remembers them. */
export function useDocxPreferences(): [DocxPreferences, (change: Partial<DocxPreferences>) => void] {
  const [preferences, setPreferences] = useState(readDocxPreferences)
  const update = (change: Partial<DocxPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change }
      writeDocxPreferences(next)
      return next
    })
  }
  return [preferences, update]
}
