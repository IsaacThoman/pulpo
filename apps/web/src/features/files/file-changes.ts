import type { FileChangeConflict, FileChangeConflictBody, FileChangeSummary, FileChangesItem } from '@pulpo/contracts'
import { ui, uit } from '@/i18n/ui'
import { ApiError } from '@/lib/api'

/** The output item a reply carries once it changed Files; the changes themselves come from the API. */
export function fileChangesItem(outputItems: readonly unknown[] | undefined): FileChangesItem | null {
  const item = (outputItems ?? []).find((entry) => (entry as { type?: string } | null)?.type === 'pulpo_file_changes')
  return (item as FileChangesItem | undefined) ?? null
}

/** The items an undo or redo was refused for, or null for any other failure. */
export function fileChangeConflicts(error: unknown): FileChangeConflict[] | null {
  if (!(error instanceof ApiError) || error.code !== 'file_changes_conflict') return null
  return (error.body as FileChangeConflictBody | undefined)?.error?.conflicts ?? []
}

export function pendingSuggestion(change: FileChangeSummary): boolean {
  return change.mode === 'suggest' && change.status === 'pending'
}

function parentPath(path: string): string {
  return path.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
}

/** A short word for what happened to the item, e.g. "edited" or "3 suggestions". */
export function fileChangeLabel(change: FileChangeSummary): string {
  if (pendingSuggestion(change) && change.nodeKind === 'doc' && change.kind === 'update' && change.pendingSuggestions !== undefined) {
    return change.pendingSuggestions === 1 ? ui("1 suggestion") : uit`${change.pendingSuggestions} suggestions`
  }
  switch (change.kind) {
    case 'create': return change.nodeKind === 'folder' ? ui("new folder") : ui("new")
    case 'update': return change.nodeKind === 'blob' ? ui("new version") : ui("edited")
    case 'move': return change.fromPath && change.toPath && parentPath(change.fromPath) === parentPath(change.toPath) ? ui("renamed") : ui("moved")
    case 'trash': return ui("deleted")
  }
}

/** A sentence describing the change and where it stands, for tooltips. */
export function fileChangeDescription(change: FileChangeSummary): string {
  const what = (() => {
    switch (change.kind) {
      case 'create': return ui("Created by the agent")
      case 'update': return change.nodeKind === 'blob' ? ui("New content from the agent") : ui("Edited by the agent")
      case 'move': return change.fromPath && change.toPath ? uit`Moved from ${change.fromPath} to ${change.toPath}` : ui("Moved by the agent")
      case 'trash': return ui("Moved to the trash by the agent")
    }
  })()
  const status = (() => {
    switch (change.status) {
      case 'pending': return change.nodeKind === 'doc' && change.kind === 'update'
        ? ui("Suggested; review it in the document")
        : ui("Suggested; waiting for you to accept or reject it")
      case 'accepted': return ui("Accepted")
      case 'rejected': return ui("Rejected")
      case 'undone': return ui("Undone")
      case 'applied': return null
    }
  })()
  const available = change.available ? null : ui("No longer available")
  return [what, status, available].filter(Boolean).join(' · ')
}

/** Why a conflicting item could not be undone or redone. */
export function fileConflictReason(conflict: FileChangeConflict): string {
  switch (conflict.reason) {
    case 'edited': return ui("Edited since the agent's reply")
    case 'moved': return ui("Moved or renamed since the agent's reply")
    case 'trashed': return ui("Moved to the trash since the agent's reply")
    case 'deleted': return ui("Permanently deleted")
    case 'restored': return ui("Restored from the trash since the agent's reply")
    case 'replaced': return ui("Replaced with other content since the agent's reply")
  }
}
