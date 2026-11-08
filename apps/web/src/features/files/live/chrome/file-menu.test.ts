import { describe, expect, it, vi } from 'vitest'
import { composeFileMenu, nativeDownloadLabel, type FileMenuHost } from './file-menu'
import type { MenuEntry } from './menu'

function outline(entries: MenuEntry[]): string[] {
  return entries.map((entry) => {
    if (entry.type === 'separator') return '---'
    if (entry.type === 'submenu') return `${entry.label} ▸ ${entry.items.map((child) => child.type === 'item' ? child.label : child.type).join(', ')}`
    if (entry.type === 'item') return `${entry.label}${entry.disabled ? ' (disabled)' : ''}${entry.destructive ? ' (destructive)' : ''}`
    return entry.type
  })
}

const noop = () => {}

function host(overrides: Partial<FileMenuHost> = {}): FileMenuHost {
  return {
    name: 'Report.docx',
    create: [{ id: 'new-document', label: 'Word document', onSelect: noop }, { id: 'new-sheet', label: 'Spreadsheet', onSelect: noop }],
    makeCopy: noop,
    download: noop,
    copyLink: noop,
    rename: noop,
    move: noop,
    pin: { pinned: false, toggle: noop },
    showInFolder: noop,
    trash: noop,
    details: noop,
    ...overrides,
  }
}

describe('composeFileMenu', () => {
  it('lays out the host and editor parts as Docs does', () => {
    const print = vi.fn()
    const entries = composeFileMenu(host(), { print, items: [{ type: 'item', id: 'page-setup', label: 'Page setup', onSelect: noop }] })
    expect(outline(entries)).toEqual([
      'New ▸ Word document, Spreadsheet',
      'Make a copy',
      '---',
      'Download ▸ Microsoft Word (.docx), PDF (print, then save as PDF)',
      'Copy link',
      '---',
      'Rename',
      'Move to…',
      'Pin to sidebar',
      'Show in folder',
      'Move to trash (destructive)',
      '---',
      'Details',
      '---',
      'Page setup',
      'Print',
    ])
    const pdf = entries.find((entry) => entry.type === 'submenu' && entry.id === 'download')
    const fallback = pdf?.type === 'submenu' ? pdf.items[1] : undefined
    if (fallback?.type === 'item') fallback.onSelect()
    expect(print).toHaveBeenCalledOnce()
  })

  it("offers the converter's PDF, editor exports, and Unpin, and locks changes to a trashed file", () => {
    const downloadPdf = vi.fn()
    const entries = composeFileMenu(
      host({ downloadPdf, pin: { pinned: true, toggle: noop }, locked: true }),
      { downloads: [{ type: 'item', id: 'csv', label: 'CSV (current sheet)', onSelect: noop }] },
    )
    expect(outline(entries)).toContain('Download ▸ Microsoft Word (.docx), PDF document (.pdf), CSV (current sheet)')
    expect(outline(entries)).toContain('Unpin from sidebar')
    expect(outline(entries)).toContain('Rename (disabled)')
    expect(outline(entries)).toContain('Move to… (disabled)')
    expect(outline(entries)).toContain('Move to trash (disabled) (destructive)')
    expect(outline(entries)).not.toContain('Print')
  })

  it("shows only the editor's own parts without a host (test harnesses)", () => {
    expect(outline(composeFileMenu(undefined, { print: noop }))).toEqual(['Print'])
    expect(outline(composeFileMenu(undefined, { print: noop, downloads: [{ type: 'item', id: 'csv', label: 'CSV', onSelect: noop }] }))).toEqual(['Download ▸ CSV', '---', 'Print'])
    expect(composeFileMenu(undefined)).toEqual([])
  })

  it('names the native download by extension', () => {
    expect(nativeDownloadLabel('Budget.xlsx')).toBe('Microsoft Excel (.xlsx)')
    expect(nativeDownloadLabel('deck.PPTX')).toBe('Microsoft PowerPoint (.pptx)')
    expect(nativeDownloadLabel('script.py')).toBe('Original format (.py)')
    expect(nativeDownloadLabel('Dockerfile')).toBe('Original file')
  })
})
