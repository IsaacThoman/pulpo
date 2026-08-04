import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { CompactionItem } from '@pulpo/contracts'

export type ToolTimelineItem = {
  id: string
  type: 'pulpo_tool'
  tool: string
  arguments: unknown
  status: string
  output: string
  isError?: boolean
  startedAt?: string
  durationMs?: number
}

export type AttachmentTimelineItem = {
  type: 'pulpo_attachment'
  attachment_id: string
  name: string
  mime_type: string
  size_bytes: number
  status: 'completed'
}

function reasoningItem(
  text: string,
  status: 'in_progress' | 'completed' = 'completed',
  durationMs?: number,
  turn?: number,
  contentIndex?: number,
) {
  return {
    id: turn !== undefined && contentIndex !== undefined ? `agent:${turn}:${contentIndex}:reasoning` : undefined,
    type: 'reasoning',
    status,
    summary: [{ type: 'summary_text', text }],
    ...(turn !== undefined ? { agent_turn: turn } : {}),
    ...(contentIndex !== undefined ? { agent_content_index: contentIndex } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

function messageItem(
  text: string,
  status: 'in_progress' | 'completed' = 'completed',
  turn?: number,
  contentIndex?: number,
) {
  return {
    id: turn !== undefined && contentIndex !== undefined ? `agent:${turn}:${contentIndex}:message` : undefined,
    type: 'message',
    role: 'assistant',
    status,
    content: [{ type: 'output_text', text }],
    ...(turn !== undefined ? { agent_turn: turn } : {}),
    ...(contentIndex !== undefined ? { agent_content_index: contentIndex } : {}),
  }
}

function pushAssistantParts(
  content: Array<{ type?: string; thinking?: string; text?: string; id?: string; name?: string; arguments?: unknown }>,
  toolItems: Map<string, ToolTimelineItem>,
  attachmentItems: Map<string, AttachmentTimelineItem>,
  output: unknown[],
  status: 'in_progress' | 'completed' = 'completed',
  turnDurationMs?: number,
  turn?: number,
) {
  let pendingReasoningDuration = turnDurationMs

  for (const [contentIndex, part] of content.entries()) {
    if (part.type === 'thinking') {
      const durationMs = pendingReasoningDuration
      pendingReasoningDuration = undefined
      output.push(reasoningItem(part.thinking ?? '', status, durationMs, turn, contentIndex))
      continue
    }
    if (part.type === 'text') {
      output.push(messageItem(part.text ?? '', status, turn, contentIndex))
      continue
    }
    if (part.type === 'toolCall' && part.id) {
      const existing = toolItems.get(part.id)
      output.push(existing ?? {
        id: part.id,
        type: 'pulpo_tool',
        tool: part.name ?? 'tool',
        arguments: part.arguments ?? {},
        status: 'running',
        output: '',
      })
      const attachment = attachmentItems.get(part.id)
      if (attachment) output.push(attachment)
    }
  }
}

/** Ordered response.output: workspace → (reasoning|message|tool)* preserving turn order. */
export function buildAgentOutput(options: {
  messages: AgentMessage[]
  skipMessageCount: number
  toolItems: Map<string, ToolTimelineItem>
  attachmentItems?: Map<string, AttachmentTimelineItem>
  workspaceItem?: Record<string, unknown>
  compactionItems?: CompactionItem[]
  /** Model-turn durations keyed by 1-based assistant turn index in this run. */
  turnDurationsMs?: Map<number, number>
  /** Last message is still streaming (use in_progress status). */
  streaming?: boolean
  terminal?: boolean
}): unknown[] {
  const {
    messages,
    skipMessageCount,
    toolItems,
    attachmentItems = new Map(),
    workspaceItem,
    compactionItems = [],
    turnDurationsMs,
    streaming = false,
    terminal = false,
  } = options
  const output: unknown[] = []
  output.push(...compactionItems.filter((item) => item.phase === 'pre_response'))
  if (workspaceItem) output.push(workspaceItem)

  const relevant = messages.slice(Math.max(0, skipMessageCount))
  const seenToolIds = new Set<string>()
  let assistantTurn = 0
  relevant.forEach((message, index) => {
    if (message.role !== 'assistant') return
    assistantTurn += 1
    output.push(...compactionItems.filter((item) => item.phase === 'agent_mid_run' && item.before_agent_turn === assistantTurn))
    const content = Array.isArray(message.content) ? message.content : []
    const isStreamingTail = streaming && index === relevant.length - 1
    const status = terminal || !isStreamingTail ? 'completed' : 'in_progress'
    pushAssistantParts(
      content as Array<{ type?: string; thinking?: string; text?: string; id?: string; name?: string; arguments?: unknown }>,
      toolItems,
      attachmentItems,
      output,
      status,
      turnDurationsMs?.get(assistantTurn),
      assistantTurn,
    )
    for (const part of content) {
      if ((part as { type?: string }).type === 'toolCall' && typeof (part as { id?: string }).id === 'string') {
        seenToolIds.add((part as { id: string }).id)
      }
    }
  })

  output.push(...compactionItems.filter((item) => item.phase === 'agent_mid_run' && !output.includes(item)))

  // Tools started before their assistant message is fully recorded (or orphans).
  for (const [id, item] of toolItems) {
    if (seenToolIds.has(id)) continue
    if (output.some((entry) => (entry as { id?: string }).id === id)) continue
    output.push(item)
    const attachment = attachmentItems.get(id)
    if (attachment) output.push(attachment)
  }

  if (terminal) {
    for (const entry of output) {
      if ((entry as { type?: string }).type === 'message') {
        (entry as { status?: string }).status = 'completed'
      }
      if ((entry as { type?: string }).type === 'reasoning') {
        (entry as { status?: string }).status = 'completed'
      }
    }
  }

  return output
}
