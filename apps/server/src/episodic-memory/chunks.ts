import { createHash } from 'node:crypto'
import type { chats, responses } from '../database/schema.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { responseInputText } from '../messages/input.js'
import { assistantOutputText } from '../responses/output-text.js'

const MAX_TURN_CHARACTERS = 7_000

export interface ChatTurnChunk {
  responseId: string
  contentHash: string
  text: string
}

function bounded(value: string, limit: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

export function chatTurnChunk(response: Pick<typeof responses.$inferSelect, 'id' | 'input' | 'output' | 'status'>): ChatTurnChunk | null {
  if (!['completed', 'incomplete'].includes(response.status)) return null
  const user = bounded(responseInputText(response.input), Math.floor(MAX_TURN_CHARACTERS * 0.45))
  const assistant = bounded(assistantOutputText(response.output), Math.floor(MAX_TURN_CHARACTERS * 0.55))
  if (!user && !assistant) return null
  const text = [user && `User: ${user}`, assistant && `Assistant: ${assistant}`].filter(Boolean).join('\n\n')
  return {
    responseId: response.id,
    text,
    contentHash: createHash('sha256').update(text).digest('hex'),
  }
}

export function activeLineageChunks(
  chat: Pick<typeof chats.$inferSelect, 'activeBranchLeafId' | 'activeResponseId'>,
  turns: Array<Pick<typeof responses.$inferSelect, 'id' | 'parentResponseId' | 'userMessageId' | 'input' | 'output' | 'status'>>,
): ChatTurnChunk[] {
  const leafId = chat.activeBranchLeafId ?? chat.activeResponseId ?? turns.at(-1)?.id ?? null
  return lineageFromLeaf(turns, leafId).flatMap((turn) => {
    const chunk = chatTurnChunk(turn)
    return chunk ? [chunk] : []
  })
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
