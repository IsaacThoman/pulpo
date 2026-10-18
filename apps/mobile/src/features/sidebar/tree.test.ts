// @vitest-environment node
import type { FileNode, SidebarState } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import type { HistoryChatSummary } from '../chat/history'
import { buildSidebarTree, folderOutline, isWithin, pinnedItemsCeiling, shownInSidebar, type SidebarRow, type SidebarTreeInput } from './tree'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const CHATS = '00000000-0000-4000-8000-000000000001'
const ARCHIVE = '00000000-0000-4000-8000-000000000002'

function chat(id: string, patch: Partial<HistoryChatSummary> = {}): HistoryChatSummary {
  return {
    id, title: id, modelId: 'model', time: '1:00 PM', section: 'Today', pinned: false, folderId: null, inFilesRoot: false,
    sortOrder: 0, createdAt: NOW - 1_000, updatedAt: NOW - 1_000, expiresAt: null, ...patch,
  }
}

function node(id: string, patch: Partial<FileNode> = {}): FileNode {
  const at = new Date(NOW - 1_000).toISOString()
  return {
    id, parentId: CHATS, kind: 'folder', name: id, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
    trashedAt: null, createdAt: at, updatedAt: at, systemRole: null, sortOrder: 0, ...patch,
  }
}

const sidebar = (patch: Partial<SidebarState> = {}): SidebarState => ({
  chatsFolderId: CHATS,
  archiveFolderId: ARCHIVE,
  folders: [
    { id: CHATS, parentId: null, name: 'Sidebar', systemRole: 'chats' },
    { id: ARCHIVE, parentId: null, name: 'Archive', systemRole: 'archive' },
  ],
  pinnedItems: [],
  ...patch,
})

function build(input: Partial<SidebarTreeInput>) {
  return buildSidebarTree({
    chats: [], sidebar: sidebar(), listings: new Map(), expanded: new Set(), order: 'default', filesEnabled: true, now: NOW, ...input,
  })
}

/** Each row as "type:id@depth", grouped by section title. */
function outline(sections: ReturnType<typeof build>['sections']) {
  const id = (row: SidebarRow) => row.type === 'chat' ? row.chat.id : row.type === 'empty' ? row.label : row.node.id
  return sections.map((section) => [section.title, section.data.map((row) => `${row.type}:${id(row)}@${row.depth}`)])
}

describe('the drawer as the web sidebar', () => {
  it('lists the Chats folder’s chats and Files items in their shared manual order', () => {
    const tree = build({
      chats: [chat('late', { sortOrder: 3 }), chat('first', { sortOrder: -2 }), chat('tie-old', { sortOrder: 1, createdAt: 1 }), chat('tie-new', { sortOrder: 1, createdAt: 2 })],
      listings: new Map([[CHATS, [node('folder', { sortOrder: 0 }), node('notes', { kind: 'doc', sortOrder: 2 })]]]),
    })
    expect(outline(tree.sections)).toEqual([['Chats', [
      'chat:first@0', 'folder:folder@0', 'chat:tie-new@0', 'chat:tie-old@0', 'item:notes@0', 'chat:late@0',
    ]]])
    expect(tree.sections[0]?.heading).toBe(true)
    // The top level always loads.
    expect(tree.folderIds).toEqual([CHATS])
  })

  it('shares one pinned list between chats and Files items from anywhere, and keeps them out of their folders', () => {
    const pinnedFolder = node('pinned-folder', { parentId: 'elsewhere', pinned: true, sortOrder: 1 })
    const tree = build({
      chats: [chat('pinned-chat', { pinned: true, sortOrder: 2 }), chat('other-pinned', { pinned: true, sortOrder: 0, folderId: 'pinned-folder' }), chat('loose')],
      sidebar: sidebar({ pinnedItems: [pinnedFolder] }),
    })
    expect(outline(tree.sections)).toEqual([
      ['Pinned', ['chat:other-pinned@0', 'folder:pinned-folder@0', 'chat:pinned-chat@0']],
      ['Chats', ['chat:loose@0']],
    ])
    expect(tree.sections[1]?.heading).toBe(true)
  })

  it('opens folders in place, nested, with their chats and items, and asks for their listings', () => {
    const tree = build({
      chats: [chat('in-work', { folderId: 'work', sortOrder: 1 }), chat('in-q3', { folderId: 'q3' })],
      listings: new Map([
        [CHATS, [node('work')]],
        ['work', [node('q3', { parentId: 'work', sortOrder: 0 }), node('brief', { kind: 'blob', parentId: 'work', sortOrder: 2 })]],
      ]),
      expanded: new Set(['work', 'q3']),
    })
    expect(outline(tree.sections)).toEqual([['Chats', [
      'folder:work@0', 'folder:q3@1', 'chat:in-q3@2', 'chat:in-work@1', 'item:brief@1',
    ]]])
    const work = tree.sections[0]!.data[0]
    expect(work).toMatchObject({ type: 'folder', expanded: true, chatCount: 1, expansionKey: 'work' })
    expect(tree.folderIds).toEqual([CHATS, 'work', 'q3'])
    // Keys are unique even when a folder shows twice (pinned, and in the tree).
    expect(new Set(tree.sections.flatMap((section) => section.data.map((row) => row.key))).size).toBe(5)
  })

  it('says an open folder is loading, or empty', () => {
    const tree = build({
      listings: new Map([[CHATS, [node('loading'), node('empty', { sortOrder: 1 })]], ['empty', []]]),
      expanded: new Set(['loading', 'empty']),
    })
    expect(outline(tree.sections)).toEqual([['Chats', ['folder:loading@0', 'empty:Loading…@1', 'folder:empty@0', 'empty:Empty@1']]])
  })

  it('opens a shortcut to a folder in place, on its own, and never into itself', () => {
    const shortcut = node('to-work', { kind: 'shortcut', parentId: 'work', target: { kind: 'folder', id: 'work', name: 'work', mimeType: null, systemRole: null, available: true } })
    const tree = build({
      listings: new Map([[CHATS, [node('work')]], ['work', [shortcut]]]),
      expanded: new Set(['work', 'shortcut:to-work']),
    })
    // Inside "work", the shortcut to "work" stays closed.
    expect(outline(tree.sections)).toEqual([['Chats', ['folder:work@0', 'folder:to-work@1']]])
    expect(tree.sections[0]!.data[1]).toMatchObject({ folderId: 'work', expansionKey: 'shortcut:to-work', expanded: false })
  })

  it('shows trashed shortcuts as items, which cannot open', () => {
    const gone = node('gone', { kind: 'shortcut', target: { kind: 'folder', id: 'x', name: 'x', mimeType: null, systemRole: null, available: false } })
    expect(outline(build({ listings: new Map([[CHATS, [gone]]]) }).sections)).toEqual([['Chats', ['item:gone@0']]])
  })

  it('leaves out chats at the top of My files and in folders the sidebar does not show', () => {
    const tree = build({ chats: [chat('in-files-root', { inFilesRoot: true }), chat('elsewhere', { folderId: 'not-listed' }), chat('loose')] })
    expect(outline(tree.sections)).toEqual([['Chats', ['chat:loose@0']]])
  })

  it('lists the top level by last activity under time headings in recent order, folders keeping their order inside', () => {
    const tree = build({
      order: 'recent',
      chats: [
        chat('today', { updatedAt: NOW - 1_000, sortOrder: 9 }),
        chat('old', { updatedAt: NOW - 40 * 86_400_000, sortOrder: -9 }),
        chat('in-work-new', { folderId: 'work', updatedAt: NOW, sortOrder: 2 }),
        chat('in-work-old', { folderId: 'work', updatedAt: NOW - 50 * 86_400_000, sortOrder: 1 }),
      ],
      listings: new Map([[CHATS, [node('work', { updatedAt: new Date(NOW - 2 * 86_400_000).toISOString() })]]]),
      expanded: new Set(['work']),
    })
    expect(outline(tree.sections)).toEqual([
      ['Today', ['chat:today@0']],
      ['Previous 7 Days', ['folder:work@0', 'chat:in-work-old@1', 'chat:in-work-new@1']],
      ['Older', ['chat:old@0']],
    ])
    expect(tree.sections.map((section) => section.heading ?? false)).toEqual([true, false, false])
  })

  it('keeps its heading, with a note, when there is nothing to list', () => {
    expect(build({}).sections).toEqual([{ key: 'chats', title: 'Chats', heading: true, data: [{ type: 'empty', key: 'root/empty', depth: 0, label: 'No chats yet' }] }])
  })

  it('shows only folders and shortcuts to folders or chats with Files off, as the server lists them', () => {
    const toChat = node('to-chat', { kind: 'shortcut', target: { kind: 'chat', id: 'c', name: 'c', mimeType: null, systemRole: null, available: true } })
    const toDoc = node('to-doc', { kind: 'shortcut', target: { kind: 'doc', id: 'd', name: 'd', mimeType: null, systemRole: null, available: true } })
    const tree = build({ filesEnabled: false, listings: new Map([[CHATS, [node('folder'), node('doc', { kind: 'doc' }), toChat, toDoc]]]) })
    expect(outline(tree.sections)).toEqual([['Chats', ['folder:folder@0', 'item:to-chat@0']]])
    expect(shownInSidebar(node('doc', { kind: 'doc' }), true)).toBe(true)
  })

  it('shows nothing of the sidebar before it loads, only the chats', () => {
    const tree = build({ sidebar: undefined, chats: [chat('loose'), chat('filed', { folderId: 'work' })], legacyFolders: [{ id: 'work', name: 'Work' }] })
    expect(outline(tree.sections)).toEqual([['Chats', ['chat:loose@0']]])
    expect(tree.folderIds).toEqual([])
  })

  it('lists chat folders from servers without the sidebar above the chats, holding only chats', () => {
    const tree = build({
      sidebar: null,
      chats: [chat('loose', { sortOrder: -5 }), chat('filed', { folderId: 'work' })],
      legacyFolders: [{ id: 'work', name: 'Work' }, { id: 'empty', name: 'Empty' }],
      expanded: new Set(['work', 'empty']),
    })
    expect(outline(tree.sections)).toEqual([['Chats', ['folder:work@0', 'chat:filed@1', 'folder:empty@0', 'empty:Empty@1', 'chat:loose@0']]])
    expect(tree.sections[0]!.data[0]).toMatchObject({ legacy: true, chatCount: 1 })
    expect(tree.folderIds).toEqual([])
  })
})

describe('moving in the drawer', () => {
  const state = sidebar({
    folders: [
      { id: CHATS, parentId: null, name: 'Sidebar', systemRole: 'chats' },
      { id: ARCHIVE, parentId: null, name: 'Archive', systemRole: 'archive' },
      { id: 'work', parentId: CHATS, name: 'Work', systemRole: null },
      { id: 'q10', parentId: 'work', name: 'Q10', systemRole: null },
      { id: 'q9', parentId: 'work', name: 'Q9', systemRole: null },
      { id: 'apps', parentId: CHATS, name: 'apps', systemRole: null },
      { id: 'old', parentId: ARCHIVE, name: 'Old', systemRole: null },
      { id: 'pinned-elsewhere', parentId: 'outside', name: 'Elsewhere', systemRole: null },
    ],
  })

  it('offers the Chats folder’s folders by name, nested, then the Archive’s (with Files on)', () => {
    expect(folderOutline(state, true)).toEqual([
      { id: 'apps', name: 'apps', depth: 0 },
      { id: 'work', name: 'Work', depth: 0 },
      { id: 'q9', name: 'Q9', depth: 1 },
      { id: 'q10', name: 'Q10', depth: 1 },
      { id: ARCHIVE, name: 'Archive', depth: 0 },
      { id: 'old', name: 'Old', depth: 1 },
    ])
    expect(folderOutline(state, false).map((folder) => folder.id)).toEqual(['apps', 'work', 'q9', 'q10'])
    expect(folderOutline(undefined, true)).toEqual([])
  })

  it('knows what is inside what, without looping on a broken tree', () => {
    expect(isWithin(state, 'q9', 'work')).toBe(true)
    expect(isWithin(state, 'work', 'work')).toBe(true)
    expect(isWithin(state, 'work', 'q9')).toBe(false)
    expect(isWithin(state, 'old', ARCHIVE)).toBe(true)
    const loop = sidebar({ folders: [{ id: 'a', parentId: 'b', name: 'a', systemRole: null }, { id: 'b', parentId: 'a', name: 'b', systemRole: null }] })
    expect(isWithin(loop, 'a', 'c')).toBe(false)
  })

  it('pins chats after the pinned Files items', () => {
    expect(pinnedItemsCeiling(sidebar({ pinnedItems: [node('a', { sortOrder: 4 }), node('b', { sortOrder: 7 })] }))).toBe(7)
    expect(pinnedItemsCeiling(null)).toBe(-1)
  })
})
