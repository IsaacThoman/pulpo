import { createHash } from 'node:crypto'
import type { chats, responses } from '../database/schema.js'
import { lineageFromLeaf } from '../messages/branching.js'
import { responseInputText } from '../messages/input.js'
import { assistantOutputText } from '../responses/output-text.js'

const MAX_TURN_CHARACTERS = 7_000
export const CHAT_INDEX_VERSION = 2
export const PASSAGE_CHARACTERS = 2_400
const PASSAGE_OVERLAP = 300

export interface ChatTurnChunk {
  responseId: string
  contentHash: string
  text: string
}

export interface ChatTurnPassage extends ChatTurnChunk {
  chunkIndex: number
}

// Index all visible text, including the tails of long answers. Transcript page
// limits remain separate from the passages used for retrieval.
export function chatTurnPassages(response: Parameters<typeof chatTurnChunk>[0]): ChatTurnPassage[] {
  if (!['completed', 'incomplete'].includes(response.status)) return []
  const sections = [
    ['User', responseInputText(response.input)],
    ['Assistant', assistantOutputText(response.output)],
  ] as const
  const normalized = sections.map(([role, value]) => {
    const text = value.replace(/\s+/g, ' ').trim()
    return text ? `${role}: ${text}` : ''
  }).filter(Boolean).join('\n\n')
  const passages: ChatTurnPassage[] = []
  for (let start = 0; start < normalized.length;) {
    let end = Math.min(start + PASSAGE_CHARACTERS, normalized.length)
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(' ', end)
      if (boundary > start + PASSAGE_CHARACTERS / 2) end = boundary
    }
    const text = normalized.slice(start, end).trim()
    passages.push({ responseId: response.id, chunkIndex: passages.length, text, contentHash: contentHash(text) })
    if (end === normalized.length) break
    start = end - PASSAGE_OVERLAP
  }
  return passages
}

export function activeLineagePassages(
  chat: Parameters<typeof activeLineageChunks>[0],
  turns: Parameters<typeof activeLineageChunks>[1],
): ChatTurnPassage[] {
  const leafId = chat.activeBranchLeafId ?? chat.activeResponseId ?? turns.at(-1)?.id ?? null
  return lineageFromLeaf(turns, leafId).flatMap(chatTurnPassages)
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
