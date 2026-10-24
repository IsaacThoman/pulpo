import type { FileChangeConflict, FileChangeSummary } from '@pulpo/contracts'
import { fileChangeConflictsOf, fileChangeLabelOf } from '@pulpo/client-core/files'
import { ui, uit } from '@/i18n/ui'
import { ApiError } from '@/lib/api'

export { fileChangesItem, pendingSuggestion } from '@pulpo/client-core/files'

/** The items an undo or redo was refused for, or null for any other failure. */
export function fileChangeConflicts(error: unknown): FileChangeConflict[] | null {
  return error instanceof ApiError ? fileChangeConflictsOf(error.code, error.body) : null
}

/** A short word for what happened to the item, e.g. "edited" or "3 suggestions". */
export function fileChangeLabel(change: FileChangeSummary): string {
  const label = fileChangeLabelOf(change)
  switch (label.kind) {
    case 'suggestions': return label.count === 1 ? ui("1 suggestion") : uit`${label.count} suggestions`
    case 'new-folder': return ui("new folder")
    case 'new': return ui("new")
    case 'new-version': return ui("new version")
    case 'edited': return ui("edited")
    case 'renamed': return ui("renamed")
    case 'moved': return ui("moved")
    case 'deleted': return ui("deleted")
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
