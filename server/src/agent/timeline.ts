import type { AgentMessage } from '@earendil-works/pi-agent-core'

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

function reasoningItem(
  text: string,
  status: 'in_progress' | 'completed' = 'completed',
  durationMs?: number,
) {
  return {
    type: 'reasoning',
    status,
    summary: [{ type: 'summary_text', text }],
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

function messageItem(text: string, status: 'in_progress' | 'completed' = 'completed') {
  return {
    type: 'message',
    role: 'assistant',
    status,
    content: [{ type: 'output_text', text }],
  }
}

function pushAssistantParts(
  content: Array<{ type?: string; thinking?: string; text?: string; id?: string; name?: string; arguments?: unknown }>,
  toolItems: Map<string, ToolTimelineItem>,
  output: unknown[],
  status: 'in_progress' | 'completed' = 'completed',
  turnDurationMs?: number,
) {
  let thinking = ''
  let text = ''
  let pendingReasoningDuration = turnDurationMs
  const flushThinking = () => {
    if (!thinking) return
    // Attach model-turn duration to the first reasoning chunk in the turn.
    const durationMs = pendingReasoningDuration
    pendingReasoningDuration = undefined
    output.push(reasoningItem(thinking, status, durationMs))
    thinking = ''
  }
  const flushText = () => {
    if (!text) return
    output.push(messageItem(text, status))
    text = ''
  }

  for (const part of content) {
    if (part.type === 'thinking') {
      flushText()
      thinking += part.thinking ?? ''
      continue
    }
    if (part.type === 'text') {
      flushThinking()
      text += part.text ?? ''
      continue
    }
    if (part.type === 'toolCall' && part.id) {
      flushThinking()
      flushText()
      const existing = toolItems.get(part.id)
      output.push(existing ?? {
        id: part.id,
        type: 'pulpo_tool',
        tool: part.name ?? 'tool',
        arguments: part.arguments ?? {},
        status: 'running',
        output: '',
      })
    }
  }
  flushThinking()
  flushText()
}

/** Ordered response.output: workspace → (reasoning|message|tool)* preserving turn order. */
export function buildAgentOutput(options: {
  messages: AgentMessage[]
  skipMessageCount: number
  toolItems: Map<string, ToolTimelineItem>
  workspaceItem?: Record<string, unknown>
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
    workspaceItem,
    turnDurationsMs,
    streaming = false,
    terminal = false,
  } = options
  const output: unknown[] = []
  if (workspaceItem) output.push(workspaceItem)

  const relevant = messages.slice(Math.max(0, skipMessageCount))
  const seenToolIds = new Set<string>()
  let assistantTurn = 0
  relevant.forEach((message, index) => {
    if (message.role !== 'assistant') return
    assistantTurn += 1
    const content = Array.isArray(message.content) ? message.content : []
    const isStreamingTail = streaming && index === relevant.length - 1
    const status = terminal || !isStreamingTail ? 'completed' : 'in_progress'
    pushAssistantParts(
      content as Array<{ type?: string; thinking?: string; text?: string; id?: string; name?: string; arguments?: unknown }>,
      toolItems,
      output,
      status,
      turnDurationsMs?.get(assistantTurn),
    )
    for (const part of content) {
      if ((part as { type?: string }).type === 'toolCall' && typeof (part as { id?: string }).id === 'string') {
        seenToolIds.add((part as { id: string }).id)
      }
    }
  })

  // Tools started before their assistant message is fully recorded (or orphans).
  for (const [id, item] of toolItems) {
    if (seenToolIds.has(id)) continue
    if (output.some((entry) => (entry as { id?: string }).id === id)) continue
    output.push(item)
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
