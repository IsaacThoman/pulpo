import { FILE_SCOPE_ROOT } from '@pulpo/contracts'

/** Adds items to a chat's Files scope once each; the root replaces everything it contains. */
export function addFileScope(ids: readonly string[], added: readonly string[]): string[] {
  if (ids.includes(FILE_SCOPE_ROOT) || added.includes(FILE_SCOPE_ROOT)) return [FILE_SCOPE_ROOT]
  return [...new Set([...ids, ...added])]
}
