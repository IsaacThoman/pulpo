/** One charged line of a settled usage event, snapshotted when the event settles. */
export interface UsageCostItem {
  /**
   * `model`: generation tokens · `tool`: paid tool calls (web search, image generation, …)
   * `task`: internal model calls such as titles and compaction · `workspace`: billed workspace time
   * `waived`: incurred cost the account could not cover and was not charged (negative amount)
   */
  kind: 'model' | 'tool' | 'task' | 'workspace' | 'waived'
  /** Tool name for `tool` items, task purpose for `task` items. */
  name?: string
  /** Tokens for `model`, calls for `tool` and `task`, minutes for `workspace`. */
  quantity: number
  costMicros: number
}
