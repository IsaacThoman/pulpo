import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageError } from './cli-args.js'
import { localStatus, planPush, pruneEmptyDirectories, readManifest, remotePath, updateManifest, type Manifest } from './cli-manifest.js'

const directories: string[] = []
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pulpo-cli-manifest-'))
  directories.push(root)
  const mirror = join(root, 'files')
  const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  return { root, mirror, manifestPath: join(root, '.pulpo', 'files.json'), put }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Files manifest', () => {
  it('reads a missing manifest as empty, drops malformed entries and rejects invalid JSON', async () => {
    const { manifestPath, put } = await workspace()
    expect(await readManifest(manifestPath)).toEqual({ version: 1, files: {} })
    await put(manifestPath, JSON.stringify({ version: 1, files: { '/a': { remote: 'A', nodeId: 'n', version: 'v', sha256: 's' }, '/b': { remote: 'B' } } }))
    expect(await readManifest(manifestPath)).toEqual({ version: 1, files: { '/a': { remote: 'A', nodeId: 'n', version: 'v', sha256: 's' } } })
    await put(manifestPath, '{')
    await expect(readManifest(manifestPath)).rejects.toThrow('is not valid JSON')
  })

  it('updates the manifest atomically, creating its directory', async () => {
    const { manifestPath } = await workspace()
    await updateManifest(manifestPath, (manifest) => { manifest.files['/x'] = { remote: 'X', nodeId: 'n', version: 'v', sha256: 's' } })
    await updateManifest(manifestPath, (manifest) => { manifest.files['/y'] = { remote: 'Y', nodeId: 'm', version: 'w', sha256: 't' } })
    expect(Object.keys(JSON.parse(await readFile(manifestPath, 'utf8')).files)).toEqual(['/x', '/y'])
  })

  it('normalizes Files paths typed in different forms', () => {
    expect(remotePath('/Projects/Plan.md', '/workspace/files')).toBe('Projects/Plan.md')
    expect(remotePath('./Projects/', '/workspace/files')).toBe('Projects')
    expect(remotePath('.', '/workspace/files')).toBe('')
    expect(remotePath('/workspace/files/Projects/Plan.md', '/workspace/files')).toBe('Projects/Plan.md')
    expect(remotePath('/workspace/files', '/workspace/files')).toBe('')
  })
})

describe('local status', () => {
  it('finds modified, new and locally deleted files without contacting Pulpo', async () => {
    const { root, mirror, put } = await workspace()
    await put(join(mirror, 'Projects/Plan.md'), 'edited')
    await put(join(mirror, 'Projects/Same.md'), 'same')
    await put(join(mirror, 'Projects/New.txt'), 'new')
    await put(join(mirror, 'Projects/.draft.swp'), 'ignored')
    await put(join(mirror, '.cache/blob'), 'ignored')
    await put(join(root, 'elsewhere/sales.csv'), 'changed')
    const manifest: Manifest = { version: 1, files: {
      [join(mirror, 'Projects/Plan.md')]: { remote: 'Projects/Plan.md', nodeId: 'n1', version: 'v1', sha256: sha('original') },
      [join(mirror, 'Projects/Same.md')]: { remote: 'Projects/Same.md', nodeId: 'n2', version: 'v2', sha256: sha('same') },
      [join(mirror, 'Projects/Gone.md')]: { remote: 'Projects/Gone.md', nodeId: 'n3', version: 'v3', sha256: sha('gone') },
      [join(root, 'elsewhere/sales.csv')]: { remote: 'Data/sales.csv', nodeId: 'n4', version: 'v4', sha256: sha('before') },
    } }

    const status = await localStatus(mirror, manifest)

    expect(status.modified.map(({ local, remote }) => [local, remote])).toEqual([
      [join(mirror, 'Projects/Plan.md'), 'Projects/Plan.md'],
      [join(root, 'elsewhere/sales.csv'), 'Data/sales.csv'],
    ])
    expect(status.added).toEqual([{ local: join(mirror, 'Projects/New.txt'), remote: 'Projects/New.txt', sha256: sha('new') }])
    expect(status.deleted).toEqual([{ local: join(mirror, 'Projects/Gone.md'), remote: 'Projects/Gone.md' }])
  })

  it('handles a workspace that never pulled anything', async () => {
    const { mirror } = await workspace()
    expect(await localStatus(mirror, { version: 1, files: {} })).toEqual({ modified: [], added: [], deleted: [] })
  })
})

describe('push selection', () => {
  async function pulled() {
    const context = await workspace()
    const { mirror, root, put } = context
    await put(join(mirror, 'Projects/Plan.md'), 'edited')
    await put(join(mirror, 'Projects/Same.md'), 'same')
    await put(join(mirror, 'Projects/New.txt'), 'new')
    await put(join(root, 'report.pdf'), 'pdf')
    const manifest: Manifest = { version: 1, files: {
      [join(mirror, 'Projects/Plan.md')]: { remote: 'Projects/Plan.md', nodeId: 'n1', version: 'v1', sha256: sha('original') },
      [join(mirror, 'Projects/Same.md')]: { remote: 'Projects/Same.md', nodeId: 'n2', version: 'v2', sha256: sha('same') },
    } }
    return { ...context, manifest }
  }

  it('pushes every modified and new mirror file by default, with manifest bases', async () => {
    const { mirror, manifest } = await pulled()
    expect(await planPush({ mirrorRoot: mirror, manifest, locals: [], force: false })).toEqual([
      { local: join(mirror, 'Projects/Plan.md'), remote: 'Projects/Plan.md', base: { nodeId: 'n1', version: 'v1' }, sha256: sha('edited') },
      { local: join(mirror, 'Projects/New.txt'), remote: 'Projects/New.txt', base: null, sha256: sha('new') },
    ])
  })

  it('drops bases and marks items with --force', async () => {
    const { mirror, manifest } = await pulled()
    const items = await planPush({ mirrorRoot: mirror, manifest, locals: [], force: true })
    expect(items.map(({ base, force }) => ({ base, force }))).toEqual([{ base: null, force: true }, { base: null, force: true }])
  })

  it('always sends named files but only changed files from named directories', async () => {
    const { mirror, manifest } = await pulled()
    const named = await planPush({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects/Same.md')], force: false })
    expect(named).toEqual([{ local: join(mirror, 'Projects/Same.md'), remote: 'Projects/Same.md', base: { nodeId: 'n2', version: 'v2' }, sha256: sha('same') }])
    const directory = await planPush({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects')], force: false })
    expect(directory.map((item) => item.remote)).toEqual(['Projects/New.txt', 'Projects/Plan.md'])
  })

  it('needs --to for files outside the mirror that were never pulled', async () => {
    const { mirror, root, manifest } = await pulled()
    await expect(planPush({ mirrorRoot: mirror, manifest, locals: [join(root, 'report.pdf')], force: false })).rejects.toThrow(UsageError)
    expect(await planPush({ mirrorRoot: mirror, manifest, locals: [join(root, 'report.pdf')], to: 'Projects/', force: false }))
      .toEqual([{ local: join(root, 'report.pdf'), remote: 'Projects/report.pdf', base: null, sha256: sha('pdf') }])
    expect((await planPush({ mirrorRoot: mirror, manifest, locals: [join(root, 'report.pdf')], to: '/Reports/q3.pdf', force: false }))[0]?.remote).toBe('Reports/q3.pdf')
  })

  it('keeps the base only when --to names the pulled item itself', async () => {
    const { mirror, manifest } = await pulled()
    const local = join(mirror, 'Projects/Plan.md')
    expect((await planPush({ mirrorRoot: mirror, manifest, locals: [local], to: 'projects/plan.md', force: false }))[0]?.base).toEqual({ nodeId: 'n1', version: 'v1' })
    expect((await planPush({ mirrorRoot: mirror, manifest, locals: [local], to: 'Projects/Copy.md', force: false }))[0]?.base).toBeNull()
  })

  it('rejects --to with several files, a directory or no file, and missing paths', async () => {
    const { mirror, root, manifest } = await pulled()
    await expect(planPush({ mirrorRoot: mirror, manifest, locals: [], to: 'X', force: false })).rejects.toThrow('--to needs exactly one local file')
    await expect(planPush({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects')], to: 'X', force: false })).rejects.toThrow('not a directory')
    await expect(planPush({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects/New.txt'), join(root, 'report.pdf')], to: 'X', force: false })).rejects.toThrow(UsageError)
    await expect(planPush({ mirrorRoot: mirror, manifest, locals: [join(root, 'missing.txt')], force: false })).rejects.toThrow('does not exist')
  })
})

describe('mirror cleanup', () => {
  it('removes empty parents up to, not including, the mirror root', async () => {
    const { mirror, put } = await workspace()
    await put(join(mirror, 'A/B/keep.txt'), 'x')
    await mkdir(join(mirror, 'A/B/C/D'), { recursive: true })
    await pruneEmptyDirectories([join(mirror, 'A/B/C/D/removed.md')], mirror)
    expect(await stat(join(mirror, 'A/B/C')).catch(() => undefined)).toBeUndefined()
    expect((await stat(join(mirror, 'A/B'))).isDirectory()).toBe(true)
    await pruneEmptyDirectories([join(mirror, 'top.md')], mirror)
    expect((await stat(mirror)).isDirectory()).toBe(true)
  })
})
