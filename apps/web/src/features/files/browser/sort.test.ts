import type { FileNode } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { sortFileNodes, toggleFileSort, uniqueChildName } from './sort'

const node = (name: string, kind: FileNode['kind'], sizeBytes = 0, updatedAt = '2026-01-01T00:00:00Z'): FileNode => ({
  id: name, parentId: null, kind, name, status: 'ready', mimeType: null, sizeBytes, revision: 0, trashedAt: null, createdAt: updatedAt, updatedAt,
})

describe('file sorting', () => {
  const nodes = [
    node('file 10.txt', 'blob', 5, '2026-01-03T00:00:00Z'),
    node('file 9.txt', 'blob', 50, '2026-01-01T00:00:00Z'),
    node('Zeta', 'folder'),
    node('notes', 'doc', 20, '2026-01-02T00:00:00Z'),
    node('alpha', 'folder'),
  ]

  it('keeps folders first and sorts names naturally', () => {
    expect(sortFileNodes(nodes, { key: 'name', direction: 'asc' }).map((item) => item.name))
      .toEqual(['alpha', 'Zeta', 'file 9.txt', 'file 10.txt', 'notes'])
    expect(sortFileNodes(nodes, { key: 'name', direction: 'desc' }).map((item) => item.name))
      .toEqual(['Zeta', 'alpha', 'notes', 'file 10.txt', 'file 9.txt'])
  })

  it('sorts by size, date, and kind', () => {
    expect(sortFileNodes(nodes, { key: 'size', direction: 'desc' }).slice(2).map((item) => item.name)).toEqual(['file 9.txt', 'notes', 'file 10.txt'])
    expect(sortFileNodes(nodes, { key: 'modified', direction: 'desc' }).slice(2).map((item) => item.name)).toEqual(['file 10.txt', 'notes', 'file 9.txt'])
    expect(sortFileNodes(nodes, { key: 'kind', direction: 'asc' }).slice(2).map((item) => item.name)).toEqual(['notes', 'file 9.txt', 'file 10.txt'])
  })

  it('flips the active column and starts dates and sizes newest/largest first', () => {
    expect(toggleFileSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' })
    expect(toggleFileSort({ key: 'name', direction: 'asc' }, 'size')).toEqual({ key: 'size', direction: 'desc' })
  })

  it('picks a free name for items created in place', () => {
    expect(uniqueChildName('Untitled folder', [node('untitled folder', 'folder'), node('Untitled folder (2)', 'folder')])).toBe('Untitled folder (3)')
    expect(uniqueChildName('Untitled.md', [node('untitled.md', 'doc')])).toBe('Untitled (2).md')
  })
})
