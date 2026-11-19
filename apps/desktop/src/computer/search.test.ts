import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compileGlob as compileGlobForTest, createLineMatcher, findFiles, globMatcher, grepFiles, SEARCH_TIME_BUDGET_MS } from './search'

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

  it('handles alternatives, classes and the edges of ** and *', () => {
    expect(globMatcher('**/a.ts')('a.ts')).toBe(true)
    expect(globMatcher('**/a.ts')('x/y/a.ts')).toBe(true)
    expect(globMatcher('**/a.ts')('xa.ts')).toBe(false)
    expect(globMatcher('src/**')('src/x/y.ts')).toBe(true)
    expect(globMatcher('a/*/c')('a/b/c')).toBe(true)
    expect(globMatcher('a/*/c')('a/b/x/c')).toBe(false)
    expect(globMatcher('a/?/c')('a///c')).toBe(false)
    expect(globMatcher('{src,lib}/{a,b{1,2}}.ts')('lib/b2.ts')).toBe(true)
    expect(globMatcher('{src,lib}/{a,b{1,2}}.ts')('lib/b3.ts')).toBe(false)
    expect(globMatcher('[{,]x')('{x')).toBe(true)
    expect(globMatcher('a,b}')('a,b}')).toBe(true)
    expect(globMatcher('[abc')('[abc')).toBe(true)
    expect(globMatcher('[a-c]1')('b1')).toBe(true)
    expect(globMatcher('SRC/*.Ts', true)('src/A.tS')).toBe(true)
    expect(globMatcher('')('')).toBe(true)
    expect(globMatcher('')('a')).toBe(false)
    expect(() => globMatcher('[z-a]')).toThrow(/character class/)
    expect(() => globMatcher('a'.repeat(1_001))).toThrow(/longer than/)
    expect(() => globMatcher('{a,b}'.repeat(8))).toThrow(/too many/)
  })

  it('answers at once for a pattern that would make a regular expression take forever', () => {
    const startedAt = Date.now()
    const matches = globMatcher(`${'*a'.repeat(20)}b`)
    expect(matches('a'.repeat(80))).toBe(false)
    expect(matches(`${'a'.repeat(80)}b`)).toBe(true)
    expect(globMatcher(`${'**a'.repeat(30)}/x`)(`${'a/'.repeat(200)}y`)).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('agrees with the regular expression it replaced', () => {
    // The translation this matcher took over from, kept here as the reference.
    const reference = (glob: string): RegExp => {
      let source = ''
      let braces = 0
      for (let index = 0; index < glob.length; index += 1) {
        const character = glob[index]!
        if (character === '*') {
          if (glob[index + 1] === '*') {
            const slashAfter = glob[index + 2] === '/'
            const atSegmentStart = index === 0 || glob[index - 1] === '/'
            index += slashAfter && atSegmentStart ? 2 : 1
            source += slashAfter && atSegmentStart ? '(?:.*/)?' : '.*'
          } else source += '[^/]*'
        } else if (character === '?') source += '[^/]'
        else if (character === '[') {
          const close = glob.indexOf(']', index + 1)
          if (close < 0) source += '\\['
          else { source += `[${glob.slice(index + 1, close).replace(/^!/, '^')}]`; index = close }
        } else if (character === '{') { braces += 1; source += '(?:' }
        else if (character === '}' && braces > 0) { braces -= 1; source += ')' }
        else if (character === ',' && braces > 0) source += '|'
        else source += character.replace(/[.+^$()|\\]/g, '\\$&')
      }
      return new RegExp(`^${source}$`)
    }
    // A fixed seed: the same thousands of cases every run.
    let seed = 0x5eed
    const random = (below: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % below }
    const pick = <T,>(items: readonly T[]) => items[random(items.length)]!
    const pieces = ['a', 'b', '.', '/', '*', '**', '**/', '?', '[ab]', '[!a]', '{a,b}', '{a,bb}', '{a,}'] as const
    const letters = ['a', 'b', '.', '/'] as const
    let compared = 0
    for (let round = 0; round < 4_000; round += 1) {
      const glob = Array.from({ length: 1 + random(6) }, () => pick(pieces)).join('')
      const expected = reference(glob)
      const matches = compileGlobForTest(glob)
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const text = Array.from({ length: random(7) }, () => pick(letters)).join('')
        if (matches(text) !== expected.test(text)) throw new Error(`glob ${JSON.stringify(glob)} against ${JSON.stringify(text)}: expected ${expected.test(text)}`)
        compared += 1
      }
    }
    expect(compared).toBe(48_000)
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
