// @vitest-environment node
import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ pinItems: vi.fn() }))
vi.mock('./operations', () => ({ refreshFiles: vi.fn() }))
vi.mock('./queries', () => ({ filesQueryKeys: {}, sidebarQuery: () => ({ queryKey: ['sidebar'] }) }))

const { withPinnedFileItems } = await import('./pinned')

const node = (id: string, sortOrder: number, createdAt = '2026-10-01T00:00:00.000Z') => ({ id, name: id, kind: 'folder', sortOrder, createdAt, pinned: true }) as unknown as FileNode
const chat = (id: string, sortOrder: number, createdAt = 0) => ({ id, sortOrder, createdAt })

describe('pinned Files items in the drawer', () => {
  it('shares the Pinned list with chats, in the shared manual order', () => {
    const sections = withPinnedFileItems([{ title: 'Pinned', data: [chat('a', 0), chat('b', 2)] }, { title: 'Chats', data: [chat('c', 0)] }], [node('folder', 1)])
    expect(sections.map((section) => [section.title, section.data.map((entry) => entry.id)])).toEqual([
      ['Pinned', ['a', 'folder', 'b']],
      ['Chats', ['c']],
    ])
  })

  it('opens a Pinned section when only Files items are pinned', () => {
    const sections = withPinnedFileItems([{ title: 'Chats', data: [chat('c', 0)] }], [node('doc', 0)])
    expect(sections.map((section) => section.title)).toEqual(['Pinned', 'Chats'])
  })

  it('leaves the sections alone with nothing pinned in Files', () => {
    const sections = [{ title: 'Chats', data: [chat('c', 0)] }]
    expect(withPinnedFileItems(sections, [])).toBe(sections)
  })
})
