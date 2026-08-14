import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  READ_MAX_OUTPUT_BYTES,
  parseReadArguments,
  readTextFile,
  resolveReadableWorkspacePath,
} from './read.js'

describe('bounded workspace reads', () => {
  let directory = ''

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pulpo-read-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  async function fixture(name: string, content: string | Uint8Array): Promise<string> {
    const path = join(directory, name)
    await writeFile(path, content)
    return path
  }

  it('returns numbered lines and an EOF footer for a small UTF-8 file', async () => {
    const result = await readTextFile(await fixture('small.txt', 'alpha\nβeta\n'), {})

    expect(result.output).toBe('1: alpha\n2: βeta\n\n[End of file - 2 lines total.]')
    expect(result.details).toMatchObject({ offset: 1, returnedLines: 2, eof: true, truncated: false, totalLines: 2 })
  })

  it('reports an empty file without inventing a line', async () => {
    const result = await readTextFile(await fixture('empty.txt', ''), {})

    expect(result.output).toBe('[End of file - empty file.]')
    expect(result.details).toMatchObject({ returnedLines: 0, eof: true, totalLines: 0 })
  })

  it('supports one-based offsets and line limits with a continuation', async () => {
    const result = await readTextFile(await fixture('range.txt', 'one\r\ntwo\r\nthree\r\nfour'), { offset: 2, limit: 2 })

    expect(result.output).toBe('2: two\n3: three\n\n[Showing lines 2-3. Continue with offset=4.]')
    expect(result.details).toMatchObject({ firstLine: 2, lastLine: 3, nextOffset: 4, eof: false, truncated: true })
  })

  it('rejects invalid ranges and incompatible readAll arguments', async () => {
    const path = await fixture('short.txt', 'one\ntwo')

    expect(() => parseReadArguments({ offset: 0 })).toThrow('offset must be an integer')
    expect(() => parseReadArguments({ limit: 2_001 })).toThrow('limit must be an integer')
    expect(() => parseReadArguments({ readAll: true, offset: 1 })).toThrow('cannot be combined')
    await expect(readTextFile(path, { offset: 3 })).rejects.toThrow('Offset 3 is out of range')
  })

  it('caps a CSV-sized read and returns the exact continuation offset', async () => {
    const rows = ['Timestamp,User,Event Type,Entity Type,Entity Details,Event Id']
    for (let index = 1; index <= 811; index += 1) rows.push(`${index},user,create,record,${'detail-'.repeat(35)},id-${index}`)
    const result = await readTextFile(await fixture('events.csv', rows.join('\n')), {})

    expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThanOrEqual(READ_MAX_OUTPUT_BYTES)
    expect(result.output).toContain('Output capped at 50 KiB')
    expect(result.output).toContain(`Continue with offset=${result.details.nextOffset}`)
    expect(result.details.nextOffset).toBeGreaterThan(1)
    expect(result.details.eof).toBe(false)
    expect(result.output).not.toContain('id-811')
  })

  it('lets readAll bypass the line limit but not the byte ceiling', async () => {
    const tinyLines = Array.from({ length: 2_001 }, (_, index) => `x${index + 1}`).join('\n')
    const path = await fixture('many-lines.txt', tinyLines)

    const paged = await readTextFile(path, {})
    const all = await readTextFile(path, { readAll: true })
    expect(paged.details).toMatchObject({ returnedLines: 2_000, nextOffset: 2_001, eof: false })
    expect(all.details).toMatchObject({ returnedLines: 2_001, nextOffset: null, eof: true })

    const large = await readTextFile(await fixture('large.txt', Array.from({ length: 500 }, () => 'z'.repeat(500)).join('\n')), { readAll: true })
    expect(Buffer.byteLength(large.output, 'utf8')).toBeLessThanOrEqual(READ_MAX_OUTPUT_BYTES)
    expect(large.details.nextOffset).toBeGreaterThan(1)
    expect(large.details.eof).toBe(false)
  })

  it('truncates oversized physical lines and preserves multibyte UTF-8 boundaries', async () => {
    const content = `${'🐙'.repeat(2_100)}\nsecond`
    const result = await readTextFile(await fixture('unicode.txt', content), {})

    expect(result.output).toContain('[line truncated at 2000 characters]')
    expect(result.output).toContain('2: second')
    expect(result.output).not.toContain('�')
    expect(result.details).toMatchObject({ longLines: 1, eof: true, truncated: true })
  })

  it('rejects binary and invalid UTF-8 content', async () => {
    await expect(readTextFile(await fixture('nul.bin', new Uint8Array([65, 0, 66])), {})).rejects.toThrow('binary file')
    await expect(readTextFile(await fixture('invalid.txt', new Uint8Array([0xff, 0xfe, 0xfd])), {})).rejects.toThrow('not valid UTF-8')
  })

  it('allows internal symlinks but rejects directories and escaping symlinks', async () => {
    const root = join(directory, 'workspace')
    await mkdir(root)
    const inside = join(root, 'inside.txt')
    const outside = join(directory, 'outside.txt')
    await writeFile(inside, 'inside')
    await writeFile(outside, 'outside')
    await symlink(inside, join(root, 'internal-link'))
    await symlink(outside, join(root, 'escaping-link'))

    await expect(resolveReadableWorkspacePath(root, root)).rejects.toThrow('regular file')
    await expect(resolveReadableWorkspacePath(root, join(root, 'internal-link'))).resolves.toBe(await realpath(inside))
    await expect(resolveReadableWorkspacePath(root, join(root, 'escaping-link'))).rejects.toThrow('escapes /workspace')
  })
})
