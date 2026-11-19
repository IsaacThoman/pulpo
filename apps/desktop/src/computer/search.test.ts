import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLineMatcher, findFiles, globMatcher, grepFiles, SEARCH_TIME_BUDGET_MS } from './search'

describe('globMatcher', () => {
  it('matches like ripgrep --glob', () => {
    expect(globMatcher('*.ts')('src/deep/a.ts')).toBe(true)
    expect(globMatcher('*.ts')('src/a.tsx')).toBe(false)
    expect(globMatcher('src/*.ts')('src/a.ts')).toBe(true)
    expect(globMatcher('src/*.ts')('src/deep/a.ts')).toBe(false)
    expect(globMatcher('src/**/*.ts')('src/a.ts')).toBe(true)
    expect(globMatcher('src/**/*.ts')('src/x/y/a.ts')).toBe(true)
    expect(globMatcher('**/test/*.{js,ts}')('a/test/b.js')).toBe(true)
    expect(globMatcher('file?.[ch]')('file1.c')).toBe(true)
    expect(globMatcher('[!a]*')('b.txt')).toBe(true)
    expect(globMatcher('a.b')('axb')).toBe(false)
    expect(globMatcher('*.TS', true)('a.ts')).toBe(true)
    expect(() => globMatcher('{a,b')).toThrow(/Unbalanced/)
  })
})

describe('createLineMatcher', () => {
  it('matches regular expressions and fixed strings per line', () => {
    expect(createLineMatcher('fo+')('foo\r\nbar\nfooo', 10)).toEqual([{ line: 1, text: 'foo' }, { line: 3, text: 'fooo' }])
    expect(createLineMatcher('a.b', { fixed: true })('axb\na.b', 10)).toEqual([{ line: 2, text: 'a.b' }])
    expect(createLineMatcher('HELLO', { ignoreCase: true })('hello', 10)).toEqual([{ line: 1, text: 'hello' }])
    expect(createLineMatcher('x')('x\nx\nx', 2)).toHaveLength(2)
  })

  it('refuses invalid patterns and stops catastrophic ones', () => {
    expect(() => createLineMatcher('(')).toThrow(/Invalid regular expression/)
    const match = createLineMatcher('^(a+)+$')
    expect(() => match(`${'a'.repeat(40)}b`, 10)).toThrow(/took too long/)
  }, 10_000)
})

describe('find and grep', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pulpo-search-'))
    await mkdir(path.join(root, 'src', 'deep'), { recursive: true })
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(path.join(root, '.git'), { recursive: true })
    await writeFile(path.join(root, 'src', 'a.ts'), 'const needle = 1\nother\n')
    await writeFile(path.join(root, 'src', 'deep', 'b.ts'), 'no\nNeedle here\n')
    await writeFile(path.join(root, 'src', 'c.bin'), Buffer.from([0, 1, 2, 110, 101, 101, 100, 108, 101]))
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.ts'), 'needle')
    await writeFile(path.join(root, '.git', 'config.ts'), 'needle')
    await symlink(os.tmpdir(), path.join(root, 'tmp-link'))
  })

  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('finds files by glob, skipping .git, node_modules and symlinks', async () => {
    await expect(findFiles(root, { pattern: '*.ts' })).resolves.toEqual({ output: 'src/a.ts\nsrc/deep/b.ts', exitCode: 0, complete: true })
    await expect(findFiles(root, { pattern: '*.ts', path: 'src/deep' })).resolves.toMatchObject({ output: 'src/deep/b.ts' })
    await expect(findFiles(root, { pattern: '*.md' })).resolves.toEqual({ output: '', exitCode: 1, complete: true })
  })

  it('greps lines as path:line:text, skipping binary files', async () => {
    await expect(grepFiles(root, { pattern: 'needle' })).resolves.toEqual({ output: 'src/a.ts:1:const needle = 1', exitCode: 0, complete: true })
    await expect(grepFiles(root, { pattern: 'needle', ignoreCase: true, path: path.join(root, 'src') })).resolves.toMatchObject({
      output: `${path.join(root, 'src')}/a.ts:1:const needle = 1\n${path.join(root, 'src')}/deep/b.ts:2:Needle here`,
    })
    await expect(grepFiles(root, { pattern: 'needle', path: 'src/a.ts' })).resolves.toMatchObject({ output: 'src/a.ts:1:const needle = 1' })
    await expect(grepFiles(root, { pattern: '' })).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('stops a search that runs past its time budget, and says so', async () => {
    const started = Date.now()
    let calls = 0
    // The clock jumps past the budget once the walk is under way.
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { calls += 1; return calls <= 2 ? started : started + SEARCH_TIME_BUDGET_MS + 1 })
    try {
      const result = await grepFiles(root, { pattern: 'needle' })
      expect(result.complete).toBe(false)
      expect(result.output).toContain(`[Stopped after ${SEARCH_TIME_BUDGET_MS / 1000} seconds; narrow the path or pattern.]`)
    } finally { clock.mockRestore() }
  })

  it('stops when cancelled', async () => {
    await expect(findFiles(root, { pattern: '*' }, () => true)).resolves.toMatchObject({ output: '' })
  })
})
