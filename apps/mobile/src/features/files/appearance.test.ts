// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false }))

const { FILE_COLOR_LABELS, FILE_COLORS, FILE_ICON_LABELS, FILE_ICONS, appearanceActionTitle, appearanceShortTitle, offersIcon, restyled, sharedAppearance, storedAppearanceIds, styledNodes } = await import('./appearance')
const { FILE_COLOR_HEX, FILE_ICON_SYMBOLS, fileIcon, fileKindLabel } = await import('./display')
const { materialSymbolNames } = await import('../../platform/symbolNames')
const { trashFolderNode } = await import('../trash/folder')

const node = (patch: Partial<FileNode> = {}): FileNode => ({
  id: 'f1', parentId: null, kind: 'folder', name: 'Projects', status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '', updatedAt: '', systemRole: null, color: null, icon: null, ...patch,
})

describe('file and folder appearance', () => {
  it('offers every color and icon the web does, each with a name, an iOS symbol, and an Android icon', () => {
    for (const color of FILE_COLORS) {
      expect(FILE_COLOR_LABELS[color]).toBeTruthy()
      expect(FILE_COLOR_HEX[color]).toMatch(/^#[0-9A-F]{6}$/)
    }
    for (const icon of FILE_ICONS) {
      expect(FILE_ICON_LABELS[icon]).toBeTruthy()
      expect(materialSymbolNames[FILE_ICON_SYMBOLS[icon]]).toBeTruthy()
    }
    // The picker's own glyphs.
    expect(materialSymbolNames.nosign).toBe('block')
    expect(materialSymbolNames.paintpalette).toBe('palette')
  })

  it('styles files and folders, not chats or shortcuts', () => {
    const items = [node(), node({ id: 'd1', kind: 'doc' }), node({ id: 'b1', kind: 'blob' }), node({ id: 'c1', kind: 'chat' }), node({ id: 's1', kind: 'shortcut' })]
    expect(styledNodes(items).map((item) => item.id)).toEqual(['f1', 'd1', 'b1'])
  })

  it('offers only a color once a built-in folder is among the items, as the web does', () => {
    expect(offersIcon([node()])).toBe(true)
    expect(appearanceActionTitle([node()])).toBe('Color and Icon…')
    expect(appearanceShortTitle([node()])).toBe('Color & Icon')
    for (const builtIn of [node({ systemRole: 'archive' }), node({ systemRole: 'chats' }), trashFolderNode()]) {
      expect(offersIcon([node(), builtIn])).toBe(false)
      expect(appearanceActionTitle([builtIn])).toBe('Color…')
      expect(appearanceShortTitle([builtIn])).toBe('Color')
    }
  })

  it('starts from what the items share, choosing nothing where they differ', () => {
    expect(sharedAppearance([node({ color: 'blue' })])).toEqual({ color: 'blue', icon: null })
    expect(sharedAppearance([node({ color: 'red', icon: 'star' }), node({ color: 'blue', icon: 'star' })])).toEqual({ color: undefined, icon: 'star' })
    // Missing values are the defaults.
    expect(sharedAppearance([node({ color: undefined }), node({ color: null })]).color).toBeNull()
  })

  it('keeps the trash’s color as a setting rather than sending it to Files', () => {
    expect(storedAppearanceIds([node(), trashFolderNode(), node({ id: 'a1', systemRole: 'archive' })])).toEqual(['f1', 'a1'])
    expect(trashFolderNode('teal').color).toBe('teal')
    expect(trashFolderNode().color).toBe('red')
  })

  it('restyles the items changed and shortcuts to them, and nothing else', () => {
    const ids = new Set(['f1'])
    expect(restyled(node(), ids, { color: 'green' }).color).toBe('green')
    const shortcut = node({ id: 's1', kind: 'shortcut', target: { id: 'f1', kind: 'folder', name: 'Projects', mimeType: null, systemRole: null, available: true } })
    expect(restyled(shortcut, ids, { icon: 'rocket' }).target?.icon).toBe('rocket')
    const other = node({ id: 'f2' })
    expect(restyled(other, ids, { color: 'green' })).toBe(other)
  })

  it('shows a chosen icon in the chosen color, while built-in folders keep their own icons', () => {
    expect(fileIcon(node({ color: 'purple', icon: 'rocket' }))).toEqual({ symbol: FILE_ICON_SYMBOLS.rocket, tint: FILE_COLOR_HEX.purple })
    expect(fileIcon(node({ systemRole: 'archive', icon: 'rocket', color: 'teal' }))).toEqual({ symbol: 'archivebox.fill', tint: FILE_COLOR_HEX.teal })
    expect(fileIcon(trashFolderNode('pink'))).toEqual({ symbol: 'trash.fill', tint: FILE_COLOR_HEX.pink })
  })

  it('shows Word files as Word documents, with an icon Android has too', () => {
    const word = fileIcon(node({ kind: 'doc', name: 'Plan.docx' }))
    expect(word.symbol).toBe('doc.text.image.fill')
    expect(fileIcon(node({ kind: 'blob', name: 'Old.DOC' })).symbol).toBe(word.symbol)
    expect(materialSymbolNames[word.symbol]).toBeTruthy()
    expect(fileKindLabel(node({ kind: 'doc', name: 'Plan.docx' }))).toBe('Word document')
  })
})
