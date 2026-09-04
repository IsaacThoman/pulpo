import type { ComposerDraft } from '@pulpo/contracts'

export interface SentComposerDraftSnapshot {
  content: string
  modelId: string
  presetSelections: Record<string, string>
  agentMode: boolean
  attachmentIds: string[]
  autoExpire?: boolean
}

export function composerDraftRevisionMatches(
  currentRevision: number,
  baseRevision?: number,
  currentDeleted = false,
): boolean {
  // Keep accepting legacy clients while updated clients roll out.
  return baseRevision === undefined
    || currentRevision === baseRevision
    // GET uses the account revision as its absence watermark. It may be newer
    // than this scope's retained tombstone because unrelated account state
    // changed after the deletion.
    || (currentDeleted && baseRevision >= currentRevision)
}

export function composerDraftMatchesSentSnapshot(
  draft: ComposerDraft,
  sent: SentComposerDraftSnapshot,
): boolean {
  const selections = (value: Record<string, string>) => JSON.stringify(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
  return draft.content.trim() === sent.content.trim()
    && draft.modelId === sent.modelId
    && draft.agentMode === sent.agentMode
    && draft.autoExpire === sent.autoExpire
    && selections(draft.presetSelections) === selections(sent.presetSelections)
    && draft.attachments.map((attachment) => attachment.id).join('\0') === sent.attachmentIds.join('\0')
}
