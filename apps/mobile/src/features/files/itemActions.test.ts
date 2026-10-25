// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false }))

const { fileItemActions, fileOpenTarget, trashItemActions } = await import('./itemActions')
const { fileIcon, fileKindLabel, fileSubtitle } = await import('./display')
const { trashFolderNode } = await import('../trash/folder')

const folder = (systemRole: FileNode['systemRole']) => ({ id: 'folder', kind: 'folder', name: 'Folder', status: 'ready', pinned: false, systemRole }) as unknown as FileNode

describe('Files item menus', () => {
  it('offer Pin on built-in folders, except the Chats folder the sidebar already lists', () => {
    const ids = (node: FileNode) => fileItemActions(node, { agent: 'none', selectable: true }).map((action) => action.id)
    expect(ids(folder('archive'))).toContain('pin')
    expect(ids(folder('chats'))).not.toContain('pin')
    expect(ids(folder(null))).toContain('pin')
  })

  it('leave the trash where it is, offering only to open it', () => {
    expect(fileItemActions(trashFolderNode(), { agent: 'none', selectable: true }).map((action) => action.id)).toEqual(['open'])
  })

  it('restore or delete trashed items, and open trashed folders', () => {
    const ids = (node: FileNode, files: boolean) => trashItemActions(node, { files, selectable: true }).map((action) => action.id)
    expect(ids(folder(null), true)).toEqual(['open', 'restore', 'restore-to', 'select', 'delete-forever'])
    expect(ids({ ...folder(null), kind: 'chat' } as FileNode, false)).toEqual(['restore', 'select', 'delete-forever'])
  })

  it('open voice recordings in the recorder, directly or through a shortcut, and share their transcript', () => {
    const recording = { id: 'rec', kind: 'recording', name: 'Standup', status: 'ready', pinned: false, mimeType: null, sizeBytes: 0, updatedAt: '2026-10-25T12:00:00.000Z' } as unknown as FileNode
    expect(fileOpenTarget(recording)).toEqual({ type: 'recording', id: 'rec', name: 'Standup' })
    const shortcut = { id: 'short', kind: 'shortcut', name: 'Standup', status: 'ready', target: { kind: 'recording', id: 'rec', name: 'Standup', mimeType: null, systemRole: null, available: true } } as unknown as FileNode
    expect(fileOpenTarget(shortcut)).toEqual({ type: 'recording', id: 'rec', name: 'Standup' })
    expect(fileItemActions(recording, { agent: 'none', selectable: false }).find((action) => action.id === 'share')?.title).toBe('Share Transcript…')
    expect(fileIcon(recording)).toEqual({ symbol: 'waveform', tint: '#FF2D55' })
    expect(fileKindLabel(recording)).toBe('Voice Recording')
    expect(fileSubtitle(recording)).toContain('Nothing recorded yet')
    expect(fileSubtitle({ ...recording, sizeBytes: 1_500_000 })).toContain('1.5 MB')
  })
})
