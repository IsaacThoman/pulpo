import type { ToolItem } from './message-timeline'

const THREAD_ID = /thread_id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** The thread a start_thread call started: from the item, or the id written in its output. */
export function startedThreadId(tool: Pick<ToolItem, 'threadId' | 'output'>): string | null {
  if (tool.threadId) return tool.threadId
  return tool.output ? THREAD_ID.exec(tool.output)?.[1]?.toLowerCase() ?? null : null
}

/** The title start_thread was given. */
export function threadTitle(tool: ToolItem): string | null {
  const args = tool.arguments
  if (!args || typeof args !== 'object') return null
  const title = (args as { title?: unknown }).title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

/** The start_thread calls of a reply that started (or are starting) a thread, for cards below it. */
export function startedThreadTools(outputItems: readonly unknown[]): ToolItem[] {
  return outputItems.filter((item): item is ToolItem => {
    const tool = item as ToolItem
    if (tool.type !== 'pulpo_tool' || tool.tool !== 'start_thread') return false
    if (tool.status === 'failed' || tool.isError) return false
    return tool.status === 'running' || Boolean(startedThreadId(tool))
  })
}
