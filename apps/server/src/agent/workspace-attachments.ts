import { lineageFromLeaf, type BranchTurn } from '../messages/branching.js'
import { responseAttachmentIds } from '../messages/input.js'

/** Only explicit attachments on this response's branch survive a workspace reset. */
export function workspaceAttachmentIds(turns: Array<BranchTurn & { output: unknown }>, responseId: string): string[] {
  const ids = new Set<string>()
  for (const turn of lineageFromLeaf(turns, responseId)) {
    for (const id of responseAttachmentIds(turn.input)) ids.add(id)
    if (!Array.isArray(turn.output)) continue
    for (const raw of turn.output) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as { type?: string; attachment_id?: unknown }
      if (item.type === 'pulpo_attachment' && typeof item.attachment_id === 'string') ids.add(item.attachment_id)
    }
  }
  return [...ids]
}
