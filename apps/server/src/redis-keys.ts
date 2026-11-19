interface RedisKeyCleaner {
  scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', size: number): Promise<[string, string[]]>
  unlink(...keys: string[]): Promise<number>
}

export async function deleteRedisKeysByPattern(client: RedisKeyCleaner, pattern: string): Promise<void> {
  let cursor = '0'
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 1_000)
    cursor = nextCursor
    if (keys.length) await client.unlink(...keys)
  } while (cursor !== '0')
}

// "This computer". The API process that holds a desktop app's socket keeps the presence set (one
// member per socket, scored by expiry) so a second socket hosting the same session survives the
// first one disconnecting; the worker reads it before publishing a request.
export const computerHostKey = (userId: string, sessionId: string) => `pulpo:computer:host:${userId}:${sessionId}`
/** Worker → every API process: `{ userId, request }`. */
export const COMPUTER_REQUESTS_CHANNEL = 'pulpo:computer-requests'
/** API process → every worker: `{ userId, response }`. */
export const COMPUTER_RESPONSES_CHANNEL = 'pulpo:computer-responses'
export const computerTransferKey = (id: string) => `pulpo:computer:transfer:${id}`
/** Single-use guard for a transfer URL. */
export const computerTransferClaimKey = (id: string) => `pulpo:computer:transfer:${id}:claim`
/** Live transfer ids scored by expiry, so maintenance can delete blobs a crashed run left behind. */
export const COMPUTER_TRANSFERS_KEY = 'pulpo:computer:transfers'
