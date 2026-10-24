// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false }))

const { fileItemActions, trashItemActions } = await import('./itemActions')
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
})
