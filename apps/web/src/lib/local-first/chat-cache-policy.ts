export const MAX_PERSISTED_CHAT_DETAIL_BYTES = 25 * 1024 * 1024

export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

interface PersistableChatQuery {
  queryHash: string
  dataUpdatedAt: number
  data: unknown
}

// Query data is immutable. Weak keys avoid retaining evicted transcripts.
const measuredBytes = new WeakMap<object, number | null>()

export function serializedQueryBytes(data: unknown): number | null {
  const object = data !== null && typeof data === 'object' ? data : undefined
  if (object && measuredBytes.has(object)) return measuredBytes.get(object)!
  let bytes: number | null = null
  try {
    const serialized = JSON.stringify(data)
    if (serialized !== undefined) bytes = utf8ByteLength(serialized)
  } catch { /* non-serializable data is not eligible for persistence */ }
  if (object) measuredBytes.set(object, bytes)
  return bytes
}

export function retainedChatQueryHashes(
  queries: PersistableChatQuery[],
  maxCount: number,
  maxBytes = MAX_PERSISTED_CHAT_DETAIL_BYTES,
): Set<string> {
  const retained = new Set<string>()
  let totalBytes = 0
  for (const query of [...queries].sort((left, right) => right.dataUpdatedAt - left.dataUpdatedAt)) {
    if (retained.size >= Math.max(0, maxCount)) break
    const bytes = serializedQueryBytes(query.data)
    if (bytes === null) continue
    if (bytes > maxBytes - totalBytes) continue
    retained.add(query.queryHash)
    totalBytes += bytes
  }
  return retained
}

interface CachedTurn { id: string; parentResponseId: string | null }
interface CachedHistory {
  responses?: CachedTurn[]
  activeBranchLeafId?: string | null
  activeResponseId?: string | null
  history?: { offset: number; leafId: string | null; hasMore: boolean; before: string | null }
}

/** Byte accounting reuses immutable response measurements instead of serializing the transcript per token. */
export function fitChatToBytes(data: unknown, budget: number): { data: unknown; bytes: number } | null {
  const chat = data as CachedHistory | undefined
  if (!chat || !Array.isArray(chat.responses)) {
    const bytes = serializedQueryBytes(data)
    return bytes !== null && bytes <= budget ? { data, bytes } : null
  }
  const { responses, ...header } = chat
  let bytes = (serializedQueryBytes({ ...header, responses: [] }) ?? budget + 1)
  const sizes = responses.map(row => serializedQueryBytes(row) ?? budget + 1)
  const total = bytes + sizes.reduce((a, b) => a + b, 0) + Math.max(0, responses.length - 1)
  if (total <= budget) return { data, bytes: total }
  // Keep a connected recent active window, never a hole in the middle of a conversation.
  const byId = new Map(responses.map((row, i) => [row.id, { row, bytes: sizes[i] }]))
  const recent: CachedTurn[] = []
  const seen = new Set<string>()
  let cursor: string | null | undefined = chat.activeBranchLeafId ?? chat.activeResponseId ?? responses.at(-1)?.id
  // Reserve metadata space for the partial-history marker.
  bytes += 512
  while (cursor && !seen.has(cursor)) {
    const entry = byId.get(cursor)
    if (!entry || bytes + entry.bytes + 1 > budget) break
    seen.add(cursor)
    recent.push(entry.row)
    bytes += entry.bytes + 1
    cursor = entry.row.parentResponseId
  }
  if (!recent.length) return null
  recent.reverse()
  let omitted = 0
  let ancestor = cursor
  while (ancestor && byId.has(ancestor) && !seen.has(ancestor)) {
    seen.add(ancestor)
    omitted++
    ancestor = byId.get(ancestor)!.row.parentResponseId
  }
  const offset = (chat.history?.offset ?? 0) + omitted
  return { bytes, data: { ...header, responses: recent, history: {
    offset, leafId: chat.activeBranchLeafId ?? chat.activeResponseId ?? recent.at(-1)!.id,
    hasMore: Boolean(cursor) || Boolean(chat.history?.hasMore), before: recent[0].id,
  } } }
}
