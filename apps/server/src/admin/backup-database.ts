import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Preserve the v1 database object without constructing a database-sized
 * string. Tables may be async so their rows are read only as they are written.
 */
export async function writeBackupDatabase(path: string, database: Record<string, Iterable<unknown> | AsyncIterable<unknown>>): Promise<void> {
  async function* chunks(): AsyncGenerator<string> {
    yield '{'
    let firstTable = true
    for (const [table, rows] of Object.entries(database)) {
      yield `${firstTable ? '' : ','}${JSON.stringify(table)}:[`
      firstTable = false
      let firstRow = true
      for await (const row of rows) {
        const serialized = JSON.stringify(row, (_, item) => typeof item === 'bigint' ? item.toString() : item) ?? 'null'
        yield `${firstRow ? '' : ','}${serialized}`
        firstRow = false
      }
      yield ']'
    }
    yield '}'
  }
  await pipeline(Readable.from(chunks(), { objectMode: false }), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
}
