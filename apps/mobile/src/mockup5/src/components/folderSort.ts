export type FolderSort = 'default' | 'ascending' | 'descending';

export function sortFolders<T extends { name: string }>(folders: readonly T[], sort: FolderSort): T[] {
  if (sort === 'default') return [...folders];
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * (sort === 'ascending' ? 1 : -1));
}
