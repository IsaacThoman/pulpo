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
    // The sidebar refuses trashed files, their folder hides them, and New may land in a trashed folder.
    expect(outline(entries)).toContain('Unpin from sidebar (disabled)')
    expect(outline(entries)).toContain('Show in folder (disabled)')
    const create = entries.find((entry) => entry.type === 'submenu' && entry.id === 'new')
    expect(create?.type === 'submenu' && create.disabled).toBe(true)
    expect(outline(entries)).toContain('Make a copy (disabled)')
    expect(outline(entries)).toContain('Rename (disabled)')
    expect(outline(entries)).toContain('Move to… (disabled)')
    expect(outline(entries)).toContain('Move to trash (disabled) (destructive)')
    expect(outline(entries)).not.toContain('Print')
    // The converter refuses files in the trash; the native download exports the open document.
    const download = entries.find((entry) => entry.type === 'submenu' && entry.id === 'download')
    expect(download?.type === 'submenu' && download.items.map((entry) => entry.type === 'item' && `${entry.id}:${Boolean(entry.disabled)}`)).toEqual(['download-native:false', 'download-pdf:true', 'csv:false'])
  })

  it('leaves Pin, Show in folder, and New available for a file that is not in the trash', () => {
    const entries = composeFileMenu(host({ pin: { pinned: true, toggle: noop } }))
    expect(outline(entries)).toContain('Unpin from sidebar')
    expect(outline(entries)).toContain('Show in folder')
    const create = entries.find((entry) => entry.type === 'submenu' && entry.id === 'new')
    expect(create?.type === 'submenu' && Boolean(create.disabled)).toBe(false)
  })

  it("waits for the converter's PDF while it is being exported", () => {
    const pdfItem = (busy: boolean) => {
      const download = composeFileMenu(host({ downloadPdf: noop, pdfBusy: busy })).find((entry) => entry.type === 'submenu' && entry.id === 'download')
      const pdf = download?.type === 'submenu' ? download.items.find((entry) => entry.type === 'item' && entry.id === 'download-pdf') : undefined
      return pdf?.type === 'item' ? Boolean(pdf.disabled) : undefined
    }
    expect(pdfItem(false)).toBe(false)
    expect(pdfItem(true)).toBe(true)
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
