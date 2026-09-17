import { responseUserAttachmentIds } from '../messages/input.js'
import { attachmentWorkspacePath, restoredAttachmentWorkspacePath } from './policy.js'

type Turn = { id: string; input: unknown }
type Attachment = {
  id: string; originalName: string; origin: string; workspacePath: string | null
  sourceResponseId: string | null
}

/** Resolve versions before staging so inventory checks cannot resurrect an older file. */
export function workspaceAttachments<T extends Attachment>(turns: Turn[], attachments: T[]): Array<T & { path: string }> {
  const byId = new Map(attachments.map((file) => [file.id, file]))
  const paths = new Map<string, T & { path: string }>()
  for (const turn of turns) {
    for (const file of attachments) {
      if (file.origin !== 'assistant' || file.sourceResponseId !== turn.id) continue
      const path = restoredAttachmentWorkspacePath(file)
      paths.set(path, { ...file, path })
    }
  }
  // Explicit inputs get their advertised ID-based path even when reattaching a deliverable.
  for (const turn of turns) {
    for (const id of responseUserAttachmentIds(turn.input)) {
      const file = byId.get(id)
      if (!file) continue
      const path = attachmentWorkspacePath(file.originalName, file.id)
      paths.set(path, { ...file, path })
    }
  }
  return [...paths.values()]
}
