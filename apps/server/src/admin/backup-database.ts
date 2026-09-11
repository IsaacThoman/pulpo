import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Preserve the v1 database object without constructing a database-sized string. */
export async function writeBackupDatabase(path: string, database: Record<string, Iterable<unknown>>): Promise<void> {
  function* chunks(): Generator<string> {
    yield '{'
    let firstTable = true
    for (const [table, rows] of Object.entries(database)) {
      yield `${firstTable ? '' : ','}${JSON.stringify(table)}:[`
      firstTable = false
      let firstRow = true
      for (const row of rows) {
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
