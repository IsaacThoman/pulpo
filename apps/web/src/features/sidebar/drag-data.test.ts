import { describe, expect, it } from 'vitest'
import { isSidebarItemDrag, readSidebarItem, writeSidebarItem } from './drag-data'

function transfer() {
  const data = new Map<string, string>()
  return {
    get types() { return [...data.keys()] },
    setData: (type: string, value: string) => { data.set(type, value) },
    getData: (type: string) => data.get(type) ?? '',
  } as unknown as DataTransfer
}

describe('sidebar drag data', () => {
  it('carries a sidebar item to folders in Files', () => {
    const dataTransfer = transfer()
    expect(isSidebarItemDrag(dataTransfer)).toBe(false)
    writeSidebarItem(dataTransfer, { id: 'chat-1', kind: 'chat', name: 'Trip planning', parentId: 'chats' })
    expect(isSidebarItemDrag(dataTransfer)).toBe(true)
    expect(readSidebarItem(dataTransfer)).toMatchObject({ id: 'chat-1', kind: 'chat', name: 'Trip planning', parentId: 'chats', status: 'ready' })
  })

  it('ignores drags without a readable item', () => {
    expect(readSidebarItem(transfer())).toBeNull()
  })
})
