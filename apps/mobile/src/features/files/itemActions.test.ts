// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false }))

const { fileItemActions, fileOpenTarget, trashItemActions } = await import('./itemActions')
const { trashFolderNode } = await import('../trash/folder')

const folder = (systemRole: FileNode['systemRole']) => ({ id: 'folder', kind: 'folder', name: 'Folder', status: 'ready', pinned: false, systemRole }) as unknown as FileNode

describe('Files item menus', () => {
  it('offer Pin on built-in folders, except the Chats folder the sidebar already lists', () => {
    const ids = (node: FileNode) => fileItemActions(node, { agent: 'none', selectable: true }).map((action) => action.id)
    expect(ids(folder('archive'))).toContain('pin')
    expect(ids(folder('chats'))).not.toContain('pin')
    expect(ids(folder(null))).toContain('pin')
  })

  it('leave the trash where it is, offering only to open it and give it a color', () => {
    const actions = fileItemActions(trashFolderNode(), { agent: 'none', selectable: true })
    expect(actions.map((action) => action.id)).toEqual(['open', 'appearance'])
    expect(actions.at(-1)?.title).toBe('Color…')
  })

  it('offer a color and icon for files and folders, but not chats or shortcuts (as on the web)', () => {
    const appearance = (node: FileNode) => fileItemActions(node, { agent: 'none', selectable: true }).find((action) => action.id === 'appearance')?.title
    expect(appearance(folder(null))).toBe('Color and Icon…')
    expect(appearance({ ...folder(null), kind: 'doc' } as FileNode)).toBe('Color and Icon…')
    expect(appearance(folder('archive'))).toBe('Color…')
    expect(appearance({ ...folder(null), kind: 'chat' } as FileNode)).toBeUndefined()
    expect(appearance({ ...folder(null), kind: 'shortcut' } as FileNode)).toBeUndefined()
  })

  it('restore or delete trashed items, and open trashed folders', () => {
    const ids = (node: FileNode, files: boolean) => trashItemActions(node, { files, selectable: true }).map((action) => action.id)
    expect(ids(folder(null), true)).toEqual(['open', 'restore', 'restore-to', 'select', 'delete-forever'])
    expect(ids({ ...folder(null), kind: 'chat' } as FileNode, false)).toEqual(['restore', 'select', 'delete-forever'])
  })
})

describe('opening Files items', () => {
  const blob = (name: string) => ({ id: 'file', kind: 'blob', name, status: 'ready', mimeType: 'application/json' }) as unknown as FileNode

  it('takes quizzes in the app, and previews other files', () => {
    expect(fileOpenTarget(blob('Capitals.QUIZ'))).toEqual({ type: 'quiz', id: 'file', name: 'Capitals.QUIZ' })
    expect(fileOpenTarget(blob('Notes.md'))).toMatchObject({ type: 'markdown' })
    expect(fileOpenTarget(blob('data.json'))).toMatchObject({ type: 'file', id: 'file' })
  })

  it('takes a quiz behind a shortcut in the app', () => {
    const shortcut = { id: 'shortcut', kind: 'shortcut', name: 'Capitals.quiz', status: 'ready', target: { id: 'file', kind: 'blob', name: 'Capitals.quiz', available: true } } as unknown as FileNode
    expect(fileOpenTarget(shortcut)).toEqual({ type: 'quiz', id: 'file', name: 'Capitals.quiz' })
  })
})
