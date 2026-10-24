// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false }))

const { fileItemActions } = await import('./itemActions')

const folder = (systemRole: FileNode['systemRole']) => ({ id: 'folder', kind: 'folder', name: 'Folder', status: 'ready', pinned: false, systemRole }) as unknown as FileNode

describe('Files item menus', () => {
  it('offer Pin on built-in folders, except the Chats folder the sidebar already lists', () => {
    const ids = (node: FileNode) => fileItemActions(node, { agent: 'none', selectable: true }).map((action) => action.id)
    expect(ids(folder('archive'))).toContain('pin')
    expect(ids(folder('chats'))).not.toContain('pin')
    expect(ids(folder(null))).toContain('pin')
  })
})
