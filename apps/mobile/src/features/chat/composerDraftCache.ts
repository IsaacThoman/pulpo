export interface CachedComposerDraft<T> {
  body: string
  attachments: T[]
}

const runtimeDrafts = new Map<string, CachedComposerDraft<unknown>>()

export function composerDraftScope(namespace: string | null, draftId: string): string {
  return `${namespace ?? 'local'}\u0000${draftId}`
}

export function cachedComposerDraft<T>(scope: string): CachedComposerDraft<T> | null {
  return runtimeDrafts.get(scope) as CachedComposerDraft<T> | undefined ?? null
}

export function cacheComposerDraft<T>(scope: string, draft: CachedComposerDraft<T>): void {
  if (!draft.body && draft.attachments.length === 0) runtimeDrafts.delete(scope)
  else runtimeDrafts.set(scope, draft as CachedComposerDraft<unknown>)
}

export function deleteCachedComposerDraft(scope: string): void {
  runtimeDrafts.delete(scope)
}

export function clearComposerDraftCacheNamespace(namespace: string): void {
  const prefix = `${namespace}\u0000`
  for (const key of runtimeDrafts.keys()) {
    if (key.startsWith(prefix)) runtimeDrafts.delete(key)
  }
}
