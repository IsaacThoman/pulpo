import type { DraftRow } from './database'

export type RuntimeComposerDraft = Omit<DraftRow, 'id' | 'userId' | 'chatId'>

const runtimeDrafts = new Map<string, RuntimeComposerDraft>()

export function runtimeComposerDraft(id: string): RuntimeComposerDraft | null {
  return runtimeDrafts.get(id) ?? null
}

export function rememberRuntimeComposerDraft(id: string, draft: RuntimeComposerDraft | null): void {
  if (draft) runtimeDrafts.set(id, draft)
  else runtimeDrafts.delete(id)
}

export function clearRuntimeComposerDraftPrefix(prefix: string): void {
  for (const id of runtimeDrafts.keys()) {
    if (id.startsWith(prefix)) runtimeDrafts.delete(id)
  }
}
