import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, Type, type AssistantMessage, type Context, type Model } from '@earendil-works/pi-ai'
import { expect, it, vi } from 'vitest'
import { buildAgentSystemPrompt, buildToolsDisabledSystemPrompt, withoutAgentTools } from './policy.js'
import { createAgentCompactor, type AgentRequestFrame } from './compaction.js'
import { summaryMessageText } from '../compaction/prompt.js'

const model: Model<'openai-responses'> = {
  id: 'test', name: 'Test', api: 'openai-responses', provider: 'test', baseUrl: 'https://example.invalid',
  reasoning: false, input: ['text'], contextWindow: 100_000, maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

it.each([false, true])('removes tools and agent instructions from the next model request (compaction: %s)', async (compact) => {
  const requests: Context[] = []
  let disabled = false
  const disabledPrompt = buildToolsDisabledSystemPrompt('Model policy', 'Be concise.', 'User memory')
  const tool: AgentTool = {
    name: 'bash', label: 'Bash', description: 'Run a command', parameters: Type.Object({}),
    execute: async () => {
      // Simulate the user continuing without tools while workspace acquisition waits.
      disabled = true
      throw new Error('Workspace tool skipped because the user chose to continue without agent tools')
    },
  }
  const summarize = vi.fn(async (_history: unknown[], _frame: AgentRequestFrame) => 'Earlier work summary')
  let counts = compact ? [200, 10] : [10]
  const compactor = createAgentCompactor({
    responseId: 'resp',
    settings: () => ({ enabled: true, modelId: 'test', thresholdTokens: 100, contextWindow: 100_000, retainedUserTokens: 20_000, summaryMaxTokens: 1_000 }),
    items: () => [],
    summarize,
    updateItem: async () => undefined,
    contextTokens: () => {
      const [tokens = 0, ...rest] = counts
      counts = rest
      return { tokens, source: 'estimate' }
    },
    // The test history is tiny; treat each message as a long turn so compacting is worthwhile.
    historyTokens: (messages) => messages.length * 10_000,
  })
  const agent = new Agent({
    initialState: { model, systemPrompt: buildAgentSystemPrompt('Model policy', 'Agent policy'), tools: [tool] },
    prepareNextTurnWithContext: async ({ context }) => {
      if (disabled) context = withoutAgentTools(context, disabledPrompt)
      const compacted = await compactor({
        phase: 'agent_mid_run', systemPrompt: context.systemPrompt, tools: context.tools ?? [], messages: context.messages, beforeAgentTurn: 2,
      })
      if (compacted) return { context: { ...context, messages: compacted } }
      return disabled ? { context } : undefined
    },
    streamFn: (_model, context) => {
      requests.push({ ...context, messages: [...context.messages], tools: context.tools?.slice() })
      const toolCall = requests.length === 1
      const message: AssistantMessage = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: toolCall ? [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: {} }] : [{ type: 'text', text: 'I can answer using the conversation.' }],
        stopReason: toolCall ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message })
      return stream
    },
  })
  agent.subscribe((event) => {
    if (event.type === 'tool_execution_end' && disabled) {
      agent.state.tools = []
      agent.state.systemPrompt = disabledPrompt
    }
  })
  await agent.prompt('Inspect my files')
  expect(requests).toHaveLength(2)
  expect(requests[0]!.tools?.map((item) => item.name)).toEqual(['bash'])
  expect(requests[0]!.systemPrompt).toContain('passwordless sudo')
  expect(requests[1]!.tools).toEqual([])
  expect(requests[1]!.systemPrompt).toBe(disabledPrompt)
  expect(JSON.stringify(requests[1])).not.toContain('Agent policy')
  expect(summarize).toHaveBeenCalledTimes(compact ? 1 : 0)
  if (compact) {
    // The summarizer sees the same tool-free frame as the next request.
    expect(summarize.mock.calls[0]![1]).toMatchObject({ systemPrompt: disabledPrompt, tools: [] })
    expect(requests[1]!.messages).toMatchObject([
      { role: 'user', content: [{ type: 'text', text: 'Inspect my files' }] },
      { role: 'user', content: [{ type: 'text', text: summaryMessageText('Earlier work summary') }] },
    ])
  }
  expect(agent.state.systemPrompt).toBe(disabledPrompt)
  expect(agent.state.tools).toEqual([])
})
