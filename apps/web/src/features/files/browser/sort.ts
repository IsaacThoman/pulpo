import { nextAvailableName, type FileNode } from '@pulpo/contracts'
import { fileExtension } from '../file-display'

export type FileSortKey = 'name' | 'modified' | 'size' | 'kind'
export interface FileSort {
  key: FileSortKey
  direction: 'asc' | 'desc'
}

export const DEFAULT_FILE_SORT: FileSort = { key: 'name', direction: 'asc' }
const SORT_STORAGE_KEY = 'pulpo.files.sort'
const SORT_KEYS: FileSortKey[] = ['name', 'modified', 'size', 'kind']

/** The trash keeps its own order, newest trashed first until changed. */
export const TRASH_SORT = { storageKey: 'pulpo.trash.sort', fallback: { key: 'modified', direction: 'desc' } } as const satisfies { storageKey: string; fallback: FileSort }

export function readFileSort({ storageKey = SORT_STORAGE_KEY, fallback = DEFAULT_FILE_SORT }: { storageKey?: string; fallback?: FileSort } = {}): FileSort {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<FileSort> | null
    if (saved && SORT_KEYS.includes(saved.key as FileSortKey) && (saved.direction === 'asc' || saved.direction === 'desc')) {
      return { key: saved.key as FileSortKey, direction: saved.direction }
    }
  } catch { /* fall back to the default */ }
  return fallback
}

export function writeFileSort(sort: FileSort, storageKey = SORT_STORAGE_KEY): void {
  try { localStorage.setItem(storageKey, JSON.stringify(sort)) } catch { /* the preference is optional */ }
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

/**
 * Folders always come first, as in desktop file managers; ties fall back to the name. `dateOf` is
 * the date "modified" sorts by (the trash sorts by when items were trashed).
 */
export function sortFileNodes<T extends FileNode>(nodes: readonly T[], sort: FileSort, dateOf: (node: T) => string = (node) => node.updatedAt): T[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  const compare = (left: T, right: T): number => {
    switch (sort.key) {
      case 'modified': return Date.parse(dateOf(left)) - Date.parse(dateOf(right))
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
