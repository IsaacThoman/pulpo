import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { responseUserAttachmentIds } from '../messages/input.js'
import { buildAgentUserPrompt, type AgentAttachment } from './policy.js'
import { assistantOutputText } from '../responses/output-text.js'

export type AgentHistoryResponse = {
  id: string
  status: string
  modelId: string
  input: unknown
  output: unknown
  createdAt: Date | string
  completedAt?: Date | string | null
}

export function messagesFromAgentContext(context: unknown): AgentMessage[] {
  if (!context || typeof context !== 'object') return []
  const messages = (context as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages as AgentMessage[] : []
}

function timestamp(value: Date | string | null | undefined): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function replayedTurn(
  response: AgentHistoryResponse,
  attachmentsById: ReadonlyMap<string, AgentAttachment>,
): AgentMessage[] {
  const attachedFiles = responseUserAttachmentIds(response.input).flatMap((id) => {
    const attachment = attachmentsById.get(id)
    return attachment ? [attachment] : []
  })
  const prompt = buildAgentUserPrompt(response.input, attachedFiles) || 'How can I help?'
  const messages: AgentMessage[] = [{
    role: 'user',
    content: prompt,
    timestamp: timestamp(response.createdAt),
  }]
  const text = response.status === 'completed' ? assistantOutputText(response.output) : ''
  if (!text) return messages
  const assistant: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'pulpo',
    model: response.modelId,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: timestamp(response.completedAt ?? response.createdAt),
  }
  messages.push(assistant)
  return messages
}

/**
 * Resolve the context inherited by a new Agent response. A response without an
 * Agent run (for example, a manually edited assistant branch) is replayed from
 * its stored user input and visible assistant text instead of resetting history.
 */
export function resolveAgentParentMessages(
  lineage: AgentHistoryResponse[],
  contextsByResponseId: ReadonlyMap<string, unknown>,
  attachmentsById: ReadonlyMap<string, AgentAttachment> = new Map(),
): AgentMessage[] {
  let checkpointIndex = -1
  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    if (messagesFromAgentContext(contextsByResponseId.get(lineage[index]!.id)).length > 0) {
      checkpointIndex = index
      break
    }
  }
  const inherited = checkpointIndex >= 0
    ? messagesFromAgentContext(contextsByResponseId.get(lineage[checkpointIndex]!.id))
    : []
  return [
    ...inherited,
    ...lineage.slice(checkpointIndex + 1).flatMap((response) => replayedTurn(response, attachmentsById)),
  ]
}
