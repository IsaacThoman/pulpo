// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { sidebarItemActions, sidebarItemOpens, sidebarItemTapOpens, sidebarTrashLabel } from './actions'

const node = (patch: Partial<FileNode> = {}): FileNode => ({
  id: 'id', parentId: 'chats', kind: 'folder', name: 'Work', status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '', updatedAt: '', systemRole: null, ...patch,
})
const ids = (actions: ReturnType<typeof sidebarItemActions>) => actions.map((action) => action.id)
const on = { folder: true, filesEnabled: true, archived: false }

describe('the drawer’s item menu', () => {
  it('offers what the web sidebar offers for a folder', () => {
    expect(ids(sidebarItemActions(node(), on))).toEqual(['new-folder', 'open', 'pin', 'rename', 'move', 'archive', 'trash'])
    expect(ids(sidebarItemActions(node({ pinned: true }), { ...on, archived: true }))).toEqual(['new-folder', 'open', 'unpin', 'rename', 'move', 'trash'])
  })

  it('leaves out Files-only actions without Files', () => {
    const actions = sidebarItemActions(node(), { ...on, filesEnabled: false })
    expect(ids(actions)).toEqual(['new-folder', 'pin', 'rename', 'move', 'trash'])
    expect(actions.at(-1)?.title).toBe('Delete')
  })

  it('lets built-in folders be opened and pinned, but not the Chats folder pinned', () => {
    expect(ids(sidebarItemActions(node({ systemRole: 'archive' }), on))).toEqual(['new-folder', 'open', 'pin'])
    expect(ids(sidebarItemActions(node({ systemRole: 'chats' }), on))).toEqual(['new-folder', 'open'])
  })

  it('deletes shortcuts, which open what they point at unless it is in the trash', () => {
    const shortcut = node({ kind: 'shortcut', target: { kind: 'doc', id: 't', name: 't', mimeType: null, systemRole: null, available: true } })
    const actions = sidebarItemActions(shortcut, { ...on, folder: false })
    expect(ids(actions)).toEqual(['open', 'pin', 'rename', 'move', 'archive', 'trash'])
    expect(actions.at(-1)?.title).toBe('Delete Shortcut')
    expect(sidebarItemOpens({ ...shortcut, target: { ...shortcut.target!, available: false } }, true)).toBe(false)
    // Without Files, only shortcuts to chats open.
    expect(sidebarItemOpens(shortcut, false)).toBe(false)
    expect(sidebarItemOpens({ ...shortcut, target: { ...shortcut.target!, kind: 'chat' } }, false)).toBe(true)
  })

  it('opens on a tap only what can open, though a trashed shortcut still says why', () => {
    const doc = node({ kind: 'doc' })
    const shortcut = (kind: 'chat' | 'doc', available: boolean) => node({ kind: 'shortcut', target: { kind, id: 't', name: 't', mimeType: null, systemRole: null, available } })
    expect(sidebarItemTapOpens(doc, true)).toBe(true)
    expect(sidebarItemTapOpens(doc, false)).toBe(false)
    expect(sidebarItemTapOpens(shortcut('chat', true), false)).toBe(true)
    expect(sidebarItemTapOpens(shortcut('doc', true), false)).toBe(false)
    expect(sidebarItemTapOpens(shortcut('chat', false), false)).toBe(true)
  })

  it('only renames and deletes chat folders from servers without the sidebar', () => {
    expect(ids(sidebarItemActions(node(), { ...on, legacy: true }))).toEqual(['rename', 'trash'])
    expect(sidebarTrashLabel(node({ kind: 'doc' }), true)).toBe('Move to Trash')
  })
})
