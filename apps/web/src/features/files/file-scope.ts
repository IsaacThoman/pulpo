import { FILE_SCOPE_ROOT } from '@pulpo/contracts'

/** Adds items to a chat's Files scope once each; the root replaces everything it contains. */
export function addFileScope(ids: readonly string[], added: readonly string[]): string[] {
  if (ids.includes(FILE_SCOPE_ROOT) || added.includes(FILE_SCOPE_ROOT)) return [FILE_SCOPE_ROOT]
  return [...new Set([...ids, ...added])]
}

/**
 * Drops items that a folder in the scope already covers, using the ancestors their chips
 * loaded. Items whose ancestors are not known yet are kept.
 */
export function pruneFileScope(ids: readonly string[], ancestorsOf: (id: string) => readonly string[] | undefined): string[] {
  const scoped = new Set(ids)
  return ids.filter((id) => !(ancestorsOf(id) ?? []).some((ancestor) => scoped.has(ancestor)))
}
