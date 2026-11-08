import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAppleShortcut } from '../../browser/shortcuts'
import type { ShortcutSpec } from '../chrome/shortcuts'
import { replaceShortcut } from '../chrome/use-editor-shortcuts'
import { docxShortcutGroups } from './docx-shortcuts'

const editorSource = readFileSync(resolve(import.meta.dirname, '../../../../../../../packages/client-core/src/office/docx/view/editor.ts'), 'utf8')

/** The Word editor keymap's combos with a modifier, read from its source ("Mod-Shift-x" and the like). */
function keymapCombos(): string[] {
  const body = /private shortcuts\(\)[\s\S]*?return bind/.exec(editorSource)?.[0]
  if (!body) throw new Error('DocxEditor.shortcuts() not found')
  const keys = [...body.matchAll(/'([^']+)'\s*[:\]]/g)].map((match) => match[1]!.replace(/\\\\/g, '\\'))
  return keys.filter((key) => /^(Mod|Ctrl|Alt|Shift)-./.test(key))
}

function parse(combo: string): ShortcutSpec {
  const parts = combo.split('-')
  // A trailing "-" names the minus key ("Mod--").
  const key = combo.endsWith('--') ? '-' : parts.pop()!
  return {
    key: key === 'Space' ? ' ' : key,
    mod: parts.includes('Mod') || parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
  }
}

describe('Word shortcuts list', () => {
  it('lists every combo the editor keymap binds', () => {
    const listed = docxShortcutGroups().flatMap((group) => group.items.flatMap((item) => item.keys.filter((key): key is ShortcutSpec => typeof key !== 'string')))
    const combos = keymapCombos()
    expect(combos.length).toBeGreaterThan(30)
    const missing = combos.filter((combo) => {
      // Cmd+H hides the app on macOS, so the list (and the shared keys) offer Docs' Cmd+Shift+H there.
      const spec = combo === 'Mod-h' && isAppleShortcut() ? { ...replaceShortcut(), mod: true, shift: true, alt: false } : parse(combo)
      return !listed.some((key) => key.key.toLowerCase() === spec.key.toLowerCase()
        && Boolean(key.mod) === spec.mod && Boolean(key.shift) === spec.shift && Boolean(key.alt) === spec.alt)
    })
    expect(missing).toEqual([])
  })

  it('names every line', () => {
    for (const group of docxShortcutGroups()) {
      expect(group.title).not.toBe('')
      for (const item of group.items) expect(item.label && item.keys.length).toBeTruthy()
    }
  })
})
