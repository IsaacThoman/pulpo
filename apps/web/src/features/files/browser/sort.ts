import { DEFAULT_FILE_SORT, parseFileSort, type FileSort } from '@pulpo/client-core/files'

export {
  DEFAULT_FILE_SORT,
  fileKindKey,
  sortFileNodes,
  toggleFileSort,
  uniqueChildName,
  type FileSort,
  type FileSortKey,
} from '@pulpo/client-core/files'

const SORT_STORAGE_KEY = 'pulpo.files.sort'

/** The trash keeps its own order, newest trashed first until changed. */
export const TRASH_SORT = { storageKey: 'pulpo.trash.sort', fallback: { key: 'modified', direction: 'desc' } } as const satisfies { storageKey: string; fallback: FileSort }

export function readFileSort({ storageKey = SORT_STORAGE_KEY, fallback = DEFAULT_FILE_SORT }: { storageKey?: string; fallback?: FileSort } = {}): FileSort {
  try {
    return parseFileSort(JSON.parse(localStorage.getItem(storageKey) ?? 'null'), fallback)
  } catch {
    return fallback
  }
}

export function writeFileSort(sort: FileSort, storageKey = SORT_STORAGE_KEY): void {
  try { localStorage.setItem(storageKey, JSON.stringify(sort)) } catch { /* the preference is optional */ }
}
