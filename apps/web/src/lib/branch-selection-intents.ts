export interface BranchSelectionIntent {
  leafId: string
  version: number
}

/** Track the latest branch-selection intent without confusing repeated selections of the same leaf. */
export class BranchSelectionIntents {
  private readonly intents = new Map<string, BranchSelectionIntent>()
  private readonly versions = new Map<string, number>()

  select(chatId: string, leafId: string): BranchSelectionIntent {
    const version = (this.versions.get(chatId) ?? 0) + 1
    const intent = { leafId, version }
    this.versions.set(chatId, version)
    this.intents.set(chatId, intent)
    return intent
  }

  current(chatId: string): BranchSelectionIntent | undefined {
    return this.intents.get(chatId)
  }

  isCurrent(chatId: string, version: number): boolean {
    return this.intents.get(chatId)?.version === version
  }

  clear(chatId: string, version: number): boolean {
    if (!this.isCurrent(chatId, version)) return false
    this.intents.delete(chatId)
    return true
  }
}
