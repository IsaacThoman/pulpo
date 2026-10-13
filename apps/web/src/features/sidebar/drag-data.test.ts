import { describe, expect, it } from 'vitest'
import { isSidebarItemDrag, readSidebarItems, writeSidebarItems } from './drag-data'

function transfer() {
  const data = new Map<string, string>()
  return {
    get types() { return [...data.keys()] },
    setData: (type: string, value: string) => { data.set(type, value) },
    getData: (type: string) => data.get(type) ?? '',
  } as unknown as DataTransfer
}

describe('sidebar drag data', () => {
  it('carries sidebar items to folders in Files, in order', () => {
    const dataTransfer = transfer()
    expect(isSidebarItemDrag(dataTransfer)).toBe(false)
    writeSidebarItems(dataTransfer, [
      { id: 'chat-1', kind: 'chat', name: 'Trip planning', parentId: 'chats' },
      { id: 'doc-1', kind: 'doc', name: 'Notes.md', parentId: 'f1' },
    ])
    expect(isSidebarItemDrag(dataTransfer)).toBe(true)
    expect(readSidebarItems(dataTransfer)).toMatchObject([
      { id: 'chat-1', kind: 'chat', name: 'Trip planning', parentId: 'chats', status: 'ready' },
      { id: 'doc-1', kind: 'doc', name: 'Notes.md', parentId: 'f1', status: 'ready' },
    ])
  })

  it('ignores drags without readable items', () => {
    expect(readSidebarItems(transfer())).toEqual([])
  })
})
