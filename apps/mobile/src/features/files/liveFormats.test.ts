import type { FileNode, MobileConfig } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' } }))
vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, mobileApi: {} }))
vi.mock('../../store/session', () => ({ useSessionStore: Object.assign(() => undefined, { getState: () => ({}) }) }))

const { formatSupported } = await import('./availability')
const { editorBundleFor, MOBILE_SCHEMA_VERSIONS } = await import('./editor/bundles')
const { editableUpload } = await import('./itemActions')
const { newLiveFiles } = await import('./liveFormats')

const config = (files?: Record<string, unknown>) => ({ capabilities: { files } }) as unknown as MobileConfig
const node = (name: string, extra: Partial<FileNode> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001', parentId: null, kind: 'blob', name, status: 'ready', mimeType: 'text/plain',
  sizeBytes: 10, revision: 0, trashedAt: null, createdAt: '', updatedAt: '', ...extra,
}) as FileNode

describe('live formats on mobile', () => {
  it('ships an editor for Markdown, text, and Word documents, and announces their schemas', () => {
    expect(editorBundleFor(null)?.format).toBe('markdown')
    expect(editorBundleFor('text')?.format).toBe('text')
    expect(editorBundleFor('document')?.format).toBe('document')
    expect(editorBundleFor('sheet')).toBeNull()
    expect(MOBILE_SCHEMA_VERSIONS).toEqual({
      markdown: editorBundleFor('markdown')!.schemaVersion,
      text: editorBundleFor('text')!.schemaVersion,
      document: editorBundleFor('document')!.schemaVersion,
    })
  })

  it('edits a format only where the server speaks the same schema', () => {
    const markdown = editorBundleFor('markdown')!.schemaVersion
    expect(formatSupported(config({ enabled: true, docSchemaVersion: markdown, liveFormats: { markdown, text: 1 } }), 'text')).toBe(true)
    expect(formatSupported(config({ enabled: true, docSchemaVersion: markdown, liveFormats: { markdown, text: 2 } }), 'text')).toBe(false)
    // Servers from before live formats edit Markdown only.
    expect(formatSupported(config({ enabled: true, docSchemaVersion: markdown }), 'text')).toBe(false)
    expect(formatSupported(config({ enabled: true, docSchemaVersion: markdown }), 'markdown')).toBe(true)
    expect(newLiveFiles(config({ enabled: true, docSchemaVersion: markdown }))).toEqual([])
    expect(newLiveFiles(config({ enabled: true, docSchemaVersion: markdown, liveFormats: { markdown, text: 1 } })).map((entry) => entry.name)).toEqual(['Untitled.txt'])
  })

  it('offers Edit for uploaded text and code files, not Markdown, binaries, or oversized files', () => {
    expect(editableUpload(node('main.py'))).toBe(true)
    expect(editableUpload(node('notes.md'))).toBe(false)
    expect(editableUpload(node('photo.png'))).toBe(false)
    expect(editableUpload(node('main.py', { sizeBytes: 50_000_000 }))).toBe(false)
    expect(editableUpload(node('main.py', { kind: 'doc' }))).toBe(false)
    expect(editableUpload(node('main.py', { trashedAt: '2026-01-01T00:00:00Z' }))).toBe(false)
  })
})
