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
