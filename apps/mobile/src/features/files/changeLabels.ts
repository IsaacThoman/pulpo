import type { FileChangeConflict, FileChangeSummary } from '@pulpo/contracts'
import { fileChangeLabelOf } from '@pulpo/client-core/files'
import { formatBytes } from './display'

/** "edited", "3 suggestions", … in English (the web words them through its translations). */
export function changeLabel(change: FileChangeSummary): string {
  const label = fileChangeLabelOf(change)
  switch (label.kind) {
    case 'suggestions': return label.count === 1 ? '1 suggestion' : `${label.count} suggestions`
    case 'new-folder': return 'new folder'
    case 'new': return 'new'
    case 'new-version': return change.fromSizeBytes !== undefined && change.toSizeBytes !== undefined
      ? `new version · ${formatBytes(change.toSizeBytes)}`
      : 'new version'
    case 'edited': return 'edited'
    case 'renamed': return 'renamed'
    case 'moved': return 'moved'
    case 'deleted': return 'deleted'
  }
}

export function conflictReason(conflict: FileChangeConflict): string {
  switch (conflict.reason) {
    case 'edited': return 'Edited since the agent’s reply'
    case 'moved': return 'Moved or renamed since the agent’s reply'
    case 'trashed': return 'Moved to the trash since the agent’s reply'
    case 'deleted': return 'Permanently deleted'
    case 'restored': return 'Restored from the trash since the agent’s reply'
    case 'replaced': return 'Replaced with other content since the agent’s reply'
  }
}
