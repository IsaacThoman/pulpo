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

export function readFileSort(): FileSort {
  try {
    return parseFileSort(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_FILE_SORT
  }
}

export function writeFileSort(sort: FileSort): void {
  try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort)) } catch { /* the preference is optional */ }
}
