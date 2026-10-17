import { nextAvailableName, type FileNode } from '@pulpo/contracts'
import { fileExtension } from './display.js'

export type FileSortKey = 'name' | 'modified' | 'size' | 'kind'
export interface FileSort {
  key: FileSortKey
  direction: 'asc' | 'desc'
}

export const DEFAULT_FILE_SORT: FileSort = { key: 'name', direction: 'asc' }
export const FILE_SORT_KEYS: readonly FileSortKey[] = ['name', 'modified', 'size', 'kind']

/** A saved sort, or the default when it is missing or no longer valid. */
export function parseFileSort(value: unknown): FileSort {
  const saved = value as Partial<FileSort> | null | undefined
  if (saved && FILE_SORT_KEYS.includes(saved.key as FileSortKey) && (saved.direction === 'asc' || saved.direction === 'desc')) {
    return { key: saved.key as FileSortKey, direction: saved.direction }
  }
  return DEFAULT_FILE_SORT
}

/** Clicking the active column flips its direction; another column starts in its natural order. */
export function toggleFileSort(current: FileSort, key: FileSortKey): FileSort {
  if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { key, direction: key === 'modified' || key === 'size' ? 'desc' : 'asc' }
}

/** Stable, locale-independent kind for sorting: folders, documents, then files by extension. */
export function fileKindKey(node: Pick<FileNode, 'kind' | 'name'>): string {
  if (node.kind === 'folder') return '0'
  if (node.kind === 'doc') return '1'
  return `2${fileExtension(node.name)}`
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders always come first, as in desktop file managers; ties fall back to the name. */
export function sortFileNodes(nodes: readonly FileNode[], sort: FileSort): FileNode[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  const compare = (left: FileNode, right: FileNode): number => {
    switch (sort.key) {
      case 'modified': return Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
      case 'size': return left.sizeBytes - right.sizeBytes
      case 'kind': return collator.compare(fileKindKey(left), fileKindKey(right))
      default: return 0
    }
  }
  return [...nodes].sort((left, right) => {
    const folders = Number(right.kind === 'folder') - Number(left.kind === 'folder')
    if (folders) return folders
    return (compare(left, right) || collator.compare(left.name, right.name)) * direction
  })
}

/** Client-side "Name (2).md" for items created in place before the server confirms them. */
export function uniqueChildName(desired: string, siblings: readonly Pick<FileNode, 'name'>[]): string {
  // The server's own suffixing, so what is shown is what gets saved.
  return nextAvailableName(desired, new Set(siblings.map((node) => node.name.toLowerCase())))
}
