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

export function retainedChatQueryHashes(
  queries: PersistableChatQuery[],
  maxCount: number,
  maxBytes = MAX_PERSISTED_CHAT_DETAIL_BYTES,
): Set<string> {
  const retained = new Set<string>()
  let totalBytes = 0
  for (const query of [...queries].sort((left, right) => right.dataUpdatedAt - left.dataUpdatedAt)) {
    if (retained.size >= Math.max(0, maxCount)) break
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(query.data)
    } catch {
      continue
    }
    if (serialized === undefined) continue
    const bytes = utf8ByteLength(serialized)
    if (bytes > maxBytes - totalBytes) continue
    retained.add(query.queryHash)
    totalBytes += bytes
  }
  return retained
}
