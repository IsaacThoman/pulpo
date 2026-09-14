import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { globToRegExp, runSearch } from './search.js'

describe('globToRegExp', () => {
  it('matches basenames when the glob has no slash', () => {
    const matcher = globToRegExp('*.ts')
    expect(matcher.test('a.ts')).toBe(true)
    expect(matcher.test('src/deep/b.ts')).toBe(true)
    expect(matcher.test('src/b.tsx')).toBe(false)
  })

  it('supports globstar, single-character, and brace groups', () => {
    expect(globToRegExp('src/**/*.{ts,tsx}').test('src/a/b/c.tsx')).toBe(true)
    expect(globToRegExp('src/**/*.{ts,tsx}').test('src/c.ts')).toBe(true)
    expect(globToRegExp('src/**/*.{ts,tsx}').test('lib/c.ts')).toBe(false)
    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true)
    expect(globToRegExp('file?.txt').test('file10.txt')).toBe(false)
  })
})

describe('runSearch fallback', () => {
  let root = ''
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'pulpo-search-')))
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'const alpha = 1\nconst beta = 2\n')
    await writeFile(join(root, 'src', 'nested', 'b.ts'), 'export const beta = alpha\n')
    await writeFile(join(root, 'README.md'), '# alpha\n')
    await writeFile(join(root, 'node_modules', 'dep', 'index.ts'), 'alpha\n')
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0x61, 0x6c, 0x70, 0x68, 0x61]))
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('finds files by glob and skips node_modules', async () => {
    const result = await runSearch({ type: 'find', pattern: '*.ts', path: root, cwd: root })
    expect(result.output.split('\n').sort()).toEqual(['src/a.ts', 'src/nested/b.ts'])
    expect(result.exitCode).toBe(0)
  })

  it('greps text files with line numbers in rg format and skips binaries', async () => {
    const result = await runSearch({ type: 'grep', pattern: 'alpha', path: root, cwd: root })
    expect(result.output.split('\n').sort()).toEqual(['README.md:1:# alpha', 'src/a.ts:1:const alpha = 1', 'src/nested/b.ts:1:export const beta = alpha'])
  })

  it('returns exit code 1 when nothing matches', async () => {
    const result = await runSearch({ type: 'grep', pattern: 'zzz-not-here', path: root, cwd: root })
    expect(result.output).toBe('')
    expect(result.exitCode).toBe(1)
  })

  it('falls back when the ripgrep binary is missing', async () => {
    const result = await runSearch({ type: 'find', pattern: 'README.md', path: root, cwd: root, rgPath: join(root, 'no-such-rg') })
    expect(result.output).toBe('README.md')
  })
})
