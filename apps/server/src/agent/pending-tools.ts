import type { AgentMessage, AgentTool, AgentEvent } from '@earendil-works/pi-agent-core'
import { validateToolArguments } from '@earendil-works/pi-ai'

/** Complete the unfinished tail of a checkpointed tool batch before another model turn. */
export async function resumePendingTools(input: {
  messages: AgentMessage[]
  tools: AgentTool[]
  emit: (event: AgentEvent) => Promise<void>
  stopped: () => boolean
  signal?: AbortSignal
  beforeExecute?: (toolCallId: string) => void
}): Promise<void> {
  const assistantIndex = input.messages.findLastIndex(m => m.role === 'assistant')
  const assistant = input.messages[assistantIndex]
  if (assistant?.role !== 'assistant') return
  const completed = new Set(input.messages.slice(assistantIndex + 1).flatMap(m => m.role === 'toolResult' ? [m.toolCallId] : []))
  for (const call of assistant.content.filter(part => part.type === 'toolCall')) {
    if (completed.has(call.id)) continue
    if (input.stopped()) return
    await input.emit({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.arguments })
    let result: Awaited<ReturnType<AgentTool['execute']>>
    let isError = false
    try {
      if (assistant.stopReason === 'length') throw new Error('Tool arguments were truncated by the model output limit')
      input.beforeExecute?.(call.id)
      const tool = input.tools.find(t => t.name === call.name)
      if (!tool) throw new Error(`Tool ${call.name} is unavailable`)
      const updates: Promise<void>[] = []
      result = await tool.execute(call.id, validateToolArguments(tool, call), input.signal, partialResult => { updates.push(input.emit({ type: 'tool_execution_update', toolCallId: call.id, toolName: call.name, args: call.arguments, partialResult })) })
      await Promise.all(updates)
    } catch (error) {
      isError = true
      result = { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], details: {} }
    }
    if (input.stopped()) return
    await input.emit({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result, isError })
    const message: AgentMessage = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content, details: result.details, isError, timestamp: Date.now() }
    input.messages.push(message)
    await input.emit({ type: 'message_end', message })
  }
}
