import { DEFAULT_FILE_ACCESS_MODE, type FileAccessMode } from '@pulpo/contracts'

/** What the agent may do with each attached item, keyed like the scope ids. */
export type FileScopeAccess = Readonly<Record<string, FileAccessMode>>

export const NO_FILE_ACCESS: FileScopeAccess = Object.freeze({})

/**
 * Adds items to a chat's Files scope once each. A folder and items inside it can both be in the
 * scope: the items tell the agent what the user pointed out.
 */
export function addFileScope(ids: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...ids, ...added])]
}

/** Keeps the modes of items still attached, as the server does, so a re-added item starts over. */
export function scopedFileAccess(ids: readonly string[], access: FileScopeAccess): Record<string, FileAccessMode> {
  return Object.fromEntries(Object.entries(access).filter(([id]) => ids.includes(id)))
}

export function fileAccessMode(access: FileScopeAccess | undefined, id: string): FileAccessMode {
  return access?.[id] ?? DEFAULT_FILE_ACCESS_MODE
}
