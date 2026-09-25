import type { ServerChat } from '@/stores/chat'

type Window = Pick<ServerChat, 'responses' | 'attachments' | 'history' | 'activeBranchLeafId' | 'activeResponseId'>

/** Small, memory-only LRU of visited lineages. The normal detail remains active-lineage-only. */
export class BranchHistoryCache {
  private entries: { owner: object; window: Window; bytes: number }[] = []
  private sizes = new WeakMap<object, number>()
  private maxBytes: number
  private maxWindows: number

  constructor(maxBytes = 8 * 1024 * 1024, maxWindows = 6) {
    this.maxBytes = maxBytes
    this.maxWindows = maxWindows
  }

  remember(owner: object, chat: ServerChat) {
    if (!chat.history || !chat.responses?.length || !chat.activeBranchLeafId) return
    this.entries = this.entries.filter(entry => entry.owner !== owner || entry.window.activeBranchLeafId !== chat.activeBranchLeafId)
    let bytes = 0
    for (const row of [...chat.responses, ...(chat.attachments ?? [])]) {
      let size = this.sizes.get(row)
      if (size === undefined) {
        // Conservative serialized UTF-16 budget; unchanged response bodies are measured once.
        size = JSON.stringify(row).length * 2
        this.sizes.set(row, size)
      }
      bytes += size
      if (bytes > this.maxBytes) return
    }
    const { responses, attachments, history, activeBranchLeafId, activeResponseId } = chat
    this.entries.push({ owner, window: { responses, attachments, history, activeBranchLeafId, activeResponseId }, bytes })
    let total = this.entries.reduce((sum, entry) => sum + entry.bytes, 0)
    while (this.entries.length > this.maxWindows || total > this.maxBytes) total -= this.entries.shift()!.bytes
  }

  find(owner: object, responseId: string): Window | undefined {
    const index = this.entries.findLastIndex(entry => entry.owner === owner && entry.window.responses?.some(row => row.id === responseId))
    if (index < 0) return
    const [entry] = this.entries.splice(index, 1)
    this.entries.push(entry!)
    return entry!.window
  }

  delete(owner: object) {
    this.entries = this.entries.filter(entry => entry.owner !== owner)
  }
}
