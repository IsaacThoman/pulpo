import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { posix, win32 } from 'node:path'
import { createPathPolicy, isWithinRoot } from './path-policy.js'

describe('isWithinRoot', () => {
  it('accepts the root itself and descendants on posix', () => {
    expect(isWithinRoot(posix, '/work', '/work')).toBe(true)
    expect(isWithinRoot(posix, '/work', '/work/a/b')).toBe(true)
    expect(isWithinRoot(posix, '/work', '/work2')).toBe(false)
    expect(isWithinRoot(posix, '/work', '/')).toBe(false)
    expect(isWithinRoot(posix, '/work', '/etc/hosts')).toBe(false)
  })

  it('is case-insensitive and drive-aware on windows', () => {
    expect(isWithinRoot(win32, 'C:\\Users\\me\\proj', 'c:\\users\\ME\\proj\\src')).toBe(true)
    expect(isWithinRoot(win32, 'C:\\Users\\me\\proj', 'D:\\other')).toBe(false)
    expect(isWithinRoot(win32, 'C:\\Users\\me\\proj', 'C:\\Users\\me')).toBe(false)
    expect(isWithinRoot(win32, 'C:\\Users\\me\\proj', 'C:\\Users\\me\\proj2')).toBe(false)
  })
})

describe('createPathPolicy (lexical)', () => {
  it('resolves relative paths against the root and rejects escapes', () => {
    const policy = createPathPolicy({ writableRoot: '/work', platform: 'posix' })
    expect(policy.writable('a/b.txt')).toBe('/work/a/b.txt')
    expect(policy.writable('/work/c')).toBe('/work/c')
    expect(() => policy.writable('../etc/passwd')).toThrow(/escapes/)
    expect(() => policy.writable('/etc/passwd')).toThrow(/escapes/)
  })

  it('rejects device prefixes and UNC on windows unless the root is UNC', () => {
    const policy = createPathPolicy({ writableRoot: 'C:\\proj', platform: 'win32' })
    expect(policy.writable('src\\index.ts')).toBe('C:\\proj\\src\\index.ts')
    expect(() => policy.writable('\\\\?\\C:\\proj\\x')).toThrow(/prefixes/)
    expect(() => policy.writable('\\\\server\\share\\x')).toThrow(/UNC/)
    expect(() => policy.writable('D:\\x')).toThrow(/escapes/)
  })

  it('allows reads anywhere when configured', async () => {
    const policy = createPathPolicy({ writableRoot: '/work', readableRoots: 'anywhere', platform: 'posix' })
    await expect(policy.readable('/etc/hosts')).resolves.toBe('/etc/hosts')
    expect(() => policy.writable('/etc/hosts')).toThrow()
  })
})

describe('createPathPolicy (filesystem)', () => {
  let directory = ''
  let root = ''
  let outside = ''

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'pulpo-policy-')))
    root = join(directory, 'root')
    outside = join(directory, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await writeFile(join(root, 'inside.txt'), 'inside')
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('refuses reads that resolve through a symlink outside the readable roots', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    const policy = createPathPolicy({ writableRoot: root })
    await expect(policy.readable('link.txt')).rejects.toThrow(/readable roots/)
    await expect(policy.readable('inside.txt')).resolves.toBe(join(root, 'inside.txt'))
  })

  it('permits reads from an extra readable root', async () => {
    const policy = createPathPolicy({ writableRoot: root, readableRoots: [outside] })
    await expect(policy.readable(join(outside, 'secret.txt'))).resolves.toBe(join(outside, 'secret.txt'))
    expect(() => policy.writable(join(outside, 'secret.txt'))).toThrow(/escapes/)
  })

  it('refuses writes into a symlinked directory that escapes the root', async () => {
    await symlink(outside, join(root, 'escape'))
    const policy = createPathPolicy({ writableRoot: root })
    await expect(policy.writableChecked('escape/new.txt')).rejects.toThrow(/escapes/)
    await expect(policy.writableChecked('fresh/dir/new.txt')).resolves.toBe(join(root, 'fresh/dir/new.txt'))
  })

  it('exports only regular files that canonicalize inside the root', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    const policy = createPathPolicy({ writableRoot: root })
    await expect(policy.exportable('link.txt')).rejects.toThrow(/escapes/)
    await expect(policy.exportable('inside.txt')).resolves.toBe(join(root, 'inside.txt'))
    await expect(policy.exportable('.')).rejects.toThrow(/regular file/)
  })
})
