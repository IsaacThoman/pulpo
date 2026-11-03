import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeBackupDatabase } from './backup-database.js'

const directories: string[] = []
async function outputPath() {
  const directory = await mkdtemp(join(tmpdir(), 'pulpo-backup-json-test-'))
  directories.push(directory)
  return join(directory, 'database.json')
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('backup database serialization', () => {
  it('matches v1 JSON including table order, empty tables and nested values', async () => {
    const database = {
      users: [{ id: 1n, text: '🐙 中文 "quoted"\\\n\t', date: new Date('2026-09-11T00:00:00Z'),
        nested: { values: [null, undefined, 123n, false], omitted: undefined }, absent: null }],
      empty: [], 'escaped"table': [{ value: 2 }],
    }
    const path = await outputPath()
    await writeBackupDatabase(path, database)
    expect(await readFile(path, 'utf8')).toBe(JSON.stringify(database, (_, value) => typeof value === 'bigint' ? value.toString() : value))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('writes async tables in order, reading each only after the previous one is written', async () => {
    const read: string[] = []
    async function* rows(table: string, count: number) {
      for (let id = 0; id < count; id++) {
        read.push(`${table}:${id}`)
        yield { id }
      }
    }
    const path = await outputPath()
    await writeBackupDatabase(path, { first: rows('first', 2), empty: rows('empty', 0), last: rows('last', 1) })
    expect(await readFile(path, 'utf8')).toBe('{"first":[{"id":0},{"id":1}],"empty":[],"last":[{"id":0}]}')
    expect(read).toEqual(['first:0', 'first:1', 'last:0'])
  })

  it('writes an empty database', async () => {
    const path = await outputPath()
    await writeBackupDatabase(path, {})
    expect(await readFile(path, 'utf8')).toBe('{}')
  })

  it('rejects row serialization failures and closes the writer', async () => {
    const path = await outputPath()
    const row: Record<string, unknown> = {}; row.self = row
    await expect(writeBackupDatabase(path, { users: [row] })).rejects.toThrow(/circular/i)
  })

  it('propagates output errors without overwriting an existing file', async () => {
    const path = await outputPath()
    await writeFile(path, 'keep')
    await expect(writeBackupDatabase(path, { users: [] })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).toBe('keep')
  })
})
