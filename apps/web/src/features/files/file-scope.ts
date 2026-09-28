import { FILE_SCOPE_ROOT } from '@pulpo/contracts'

/** Adds a folder to a chat's Files scope; the root replaces every folder it contains. */
export function addFileScope(ids: readonly string[], id: string): string[] {
  if (id === FILE_SCOPE_ROOT) return [FILE_SCOPE_ROOT]
  if (ids.includes(FILE_SCOPE_ROOT) || ids.includes(id)) return [...ids]
  return [...ids, id]
}
