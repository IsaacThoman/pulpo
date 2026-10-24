import type { FileChangeConflict, FileChangeConflictBody, FileChangeSummary, FileChangesItem } from '@pulpo/contracts'

/** The output item a reply carries once it changed Files; the changes themselves come from the API. */
export function fileChangesItem(outputItems: readonly unknown[] | undefined): FileChangesItem | null {
  const item = (outputItems ?? []).find((entry) => (entry as { type?: string } | null)?.type === 'pulpo_file_changes')
  return (item as FileChangesItem | undefined) ?? null
}

/** The items an undo or redo was refused for, from a failed request's code and body; null for other failures. */
export function fileChangeConflictsOf(code: string | undefined, body: unknown): FileChangeConflict[] | null {
  if (code !== 'file_changes_conflict') return null
  return (body as FileChangeConflictBody | undefined)?.error?.conflicts ?? []
}

export function pendingSuggestion(change: FileChangeSummary): boolean {
  return change.mode === 'suggest' && change.status === 'pending'
}

function parentPath(path: string): string {
  return path.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
}

/** What happened to the item, for a short label such as "edited" or "3 suggestions". */
export type FileChangeLabel =
  | { kind: 'suggestions'; count: number }
  | { kind: 'new-folder' | 'new' | 'new-version' | 'edited' | 'renamed' | 'moved' | 'deleted' }

export function fileChangeLabelOf(change: FileChangeSummary): FileChangeLabel {
  if (pendingSuggestion(change) && change.nodeKind === 'doc' && change.kind === 'update' && change.pendingSuggestions !== undefined) {
    return { kind: 'suggestions', count: change.pendingSuggestions }
  }
  switch (change.kind) {
    case 'create': return { kind: change.nodeKind === 'folder' ? 'new-folder' : 'new' }
    case 'update': return { kind: change.nodeKind === 'blob' ? 'new-version' : 'edited' }
    case 'move': return { kind: change.fromPath && change.toPath && parentPath(change.fromPath) === parentPath(change.toPath) ? 'renamed' : 'moved' }
    case 'trash': return { kind: 'deleted' }
  }
}
