import { describe, expect, it, vi } from 'vitest'
import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { createQuestionTool } from './question-tool.js'
import { resumePendingTools } from './pending-tools.js'

const model: Model<'openai-responses'> = { id: 'test', name: 'test', api: 'openai-responses', provider: 'test', baseUrl: 'http://unused', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000 }
const assistant: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'toolUse', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, content: [
  { type: 'toolCall', id: 'before', name: 'work', arguments: {} },
  { type: 'toolCall', id: 'question', name: 'request_user_input', arguments: { questions: [{ id: 'q', prompt: 'Which one?' }] } },
  { type: 'toolCall', id: 'after', name: 'work', arguments: {} },
] }
const result = { content: [{ type: 'text' as const, text: 'done' }], details: {} }

describe('durable question tool boundary', () => {
  it('parks the real agent loop without another model call, then resumes remaining tools without replaying completed work', async () => {
    let paused = false
    let checkpoint: AgentMessage[] = []
    const work = vi.fn(async (_id: string) => result)
    const stream = vi.fn(() => {
      const events = new AssistantMessageEventStream()
      events.push({ type: 'done', reason: 'toolUse', message: assistant })
      events.end()
      return events
    })
    let agent!: Agent
    const tools: AgentTool[] = [
      { name: 'work', label: 'Work', description: 'Work', parameters: Type.Object({}), execute: work },
      createQuestionTool(async () => {
        checkpoint = structuredClone(agent.state.messages)
        paused = true
        agent.abort()
        return result
      }),
    ]
    agent = new Agent({ initialState: { model, tools }, streamFn: stream, toolExecution: 'sequential', shouldStopAfterTurn: () => paused })
    await agent.prompt('Do the work')
    expect(stream).toHaveBeenCalledOnce()
    expect(work).toHaveBeenCalledOnce()
    expect(checkpoint.filter(m => m.role === 'toolResult').map(m => m.toolCallId)).toEqual(['before'])
    expect(agent.state.isStreaming).toBe(false)

    const answer = vi.fn(async () => ({ ...result, content: [{ type: 'text' as const, text: 'Custom user answer' }] }))
    const resumed = [...checkpoint]
    await resumePendingTools({ messages: resumed, tools: [tools[0]!, createQuestionTool(answer)], emit: async () => {}, stopped: () => false })
    expect(work).toHaveBeenCalledTimes(2)
    expect(work.mock.calls[1]?.[0]).toBe('after')
    expect(answer).toHaveBeenCalledOnce()
    expect(resumed.filter(m => m.role === 'toolResult').map(m => m.toolCallId)).toEqual(['before', 'question', 'after'])
    await resumePendingTools({ messages: resumed, tools, emit: async () => {}, stopped: () => false })
    expect(work).toHaveBeenCalledTimes(2)
  })
  it('does no work after cancellation', async () => {
    const execute = vi.fn(async () => result)
    await resumePendingTools({ messages: [assistant], tools: [{ name: 'work', label: 'Work', description: 'Work', parameters: Type.Object({}), execute }], emit: async () => {}, stopped: () => true })
    expect(execute).not.toHaveBeenCalled()
  })
  it('rejects malformed question sets before creating a pending request', async () => {
    const execute = vi.fn()
    await expect(createQuestionTool(execute).execute('q', { questions: [] })).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
})
