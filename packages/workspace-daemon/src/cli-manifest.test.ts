import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageError } from './cli-args.js'
import { localStatus, planPush, pruneEmptyDirectories, readManifest, remotePath, updateManifest, type Manifest } from './cli-manifest.js'

const directories: string[] = []
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const planItems = async (...input: Parameters<typeof planPush>) => (await planPush(...input)).items

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
    expect(await readManifest(manifestPath)).toEqual({ version: 1, files: {}, moved: {} })
    await put(manifestPath, JSON.stringify({
      version: 1, files: { '/a': { remote: 'A', nodeId: 'n', version: 'v', sha256: 's' }, '/b': { remote: 'B' } },
      moved: { '/c': { remote: 'C', to: 'D' }, '/d': { remote: 'D', to: null }, '/e': { to: 'x' } },
    }))
    expect(await readManifest(manifestPath)).toEqual({
      version: 1, files: { '/a': { remote: 'A', nodeId: 'n', version: 'v', sha256: 's' } }, moved: { '/c': { remote: 'C', to: 'D' }, '/d': { remote: 'D', to: null } },
    })
    await put(manifestPath, '{')
    await expect(readManifest(manifestPath)).rejects.toThrow('is not valid JSON')
  })

  it('updates the manifest atomically, creating its directory, in the documented format', async () => {
    const { manifestPath } = await workspace()
    await updateManifest(manifestPath, (manifest) => { manifest.files['/x'] = { remote: 'X', nodeId: 'n', version: 'v', sha256: 's' } })
    await updateManifest(manifestPath, (manifest) => { manifest.files['/y'] = { remote: 'Y', nodeId: 'm', version: 'w', sha256: 't' } })
    const written = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(Object.keys(written)).toEqual(['version', 'files'])
    expect(Object.keys(written.files)).toEqual(['/x', '/y'])
    expect(await stat(`${manifestPath}.lock`).catch(() => undefined)).toBeUndefined()
  })

  it('loses no entries when several commands update it at once', async () => {
    const { manifestPath } = await workspace()
    await Promise.all(Array.from({ length: 25 }, (_, index) => updateManifest(manifestPath, async (manifest) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5))
      manifest.files[`/file-${index}`] = { remote: `F${index}`, nodeId: 'n', version: 'v', sha256: 's' }
    })))
    expect(Object.keys((await readManifest(manifestPath)).files)).toHaveLength(25)
  })

  it('waits for a live lock holder and breaks the lock of a dead one', async () => {
    const { manifestPath, put } = await workspace()
    const lock = `${manifestPath}.lock`
    await put(lock, String(process.pid))
    setTimeout(() => void rm(lock, { force: true }), 200)
    const startedAt = Date.now()
    await updateManifest(manifestPath, (manifest) => { manifest.files['/a'] = { remote: 'A', nodeId: 'n', version: 'v', sha256: 's' } })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150)

    await put(lock, '2147483646')
    await updateManifest(manifestPath, (manifest) => { manifest.files['/b'] = { remote: 'B', nodeId: 'n', version: 'v', sha256: 's' } })
    expect(Object.keys((await readManifest(manifestPath)).files)).toEqual(['/a', '/b'])
  })

  it('drops tombstones once their copy is gone or tracked again', async () => {
    const { root, manifestPath, put } = await workspace()
    await put(join(root, 'kept.md'), 'x'); await put(join(root, 'repulled.md'), 'y')
    await updateManifest(manifestPath, (manifest) => {
      manifest.moved[join(root, 'kept.md')] = { remote: 'Kept.md', to: 'Archive' }
      manifest.moved[join(root, 'gone.md')] = { remote: 'Gone.md', to: null }
      manifest.moved[join(root, 'repulled.md')] = { remote: 'Repulled.md', to: 'Archive' }
      manifest.files[join(root, 'repulled.md')] = { remote: 'Archive/Repulled.md', nodeId: 'n', version: 'v', sha256: sha('y') }
    })
    expect((await readManifest(manifestPath)).moved).toEqual({ [join(root, 'kept.md')]: { remote: 'Kept.md', to: 'Archive' } })
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
    await put(join(mirror, 'Projects/.0a1b2c3d4e5f.pulpo-upload'), 'upload in progress')
    await put(join(mirror, 'Projects/Big.pdf.0f8fad5b-d9cb-469f-a165-70867728950e.upload'), 'old daemon upload')
    await put(join(mirror, '.cache/blob'), 'ignored')
    await put(join(root, 'elsewhere/sales.csv'), 'changed')
    const manifest: Manifest = { version: 1, moved: {}, files: {
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

  it('lists copies of moved or trashed items apart from new files', async () => {
    const { mirror, put } = await workspace()
    await put(join(mirror, 'Projects/Plan.md'), 'edited after the move')
    const status = await localStatus(mirror, { version: 1, files: {}, moved: { [join(mirror, 'Projects/Plan.md')]: { remote: 'Projects/Plan.md', to: 'Archive' } } })
    expect(status).toEqual({ modified: [], added: [], deleted: [], detached: [{ local: join(mirror, 'Projects/Plan.md'), remote: 'Projects/Plan.md', to: 'Archive' }] })
  })

  it('handles a workspace that never pulled anything', async () => {
    const { mirror } = await workspace()
    expect(await localStatus(mirror, { version: 1, files: {}, moved: {} })).toEqual({ modified: [], added: [], deleted: [], detached: [] })
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
    const manifest: Manifest = { version: 1, moved: {}, files: {
      [join(mirror, 'Projects/Plan.md')]: { remote: 'Projects/Plan.md', nodeId: 'n1', version: 'v1', sha256: sha('original') },
      [join(mirror, 'Projects/Same.md')]: { remote: 'Projects/Same.md', nodeId: 'n2', version: 'v2', sha256: sha('same') },
    } }
    return { ...context, manifest }
  }

  it('pushes every modified and new mirror file by default, with manifest bases', async () => {
    const { mirror, manifest } = await pulled()
    expect(await planPush({ mirrorRoot: mirror, manifest, locals: [], force: false })).toEqual({ refused: [], items: [
      { local: join(mirror, 'Projects/Plan.md'), remote: 'Projects/Plan.md', base: { nodeId: 'n1', version: 'v1' }, sha256: sha('edited') },
      { local: join(mirror, 'Projects/New.txt'), remote: 'Projects/New.txt', base: null, sha256: sha('new') },
    ] })
  })

  it('drops bases and marks items with --force', async () => {
    const { mirror, manifest } = await pulled()
    const items = await planItems({ mirrorRoot: mirror, manifest, locals: [], force: true })
    expect(items.map(({ base, force }) => ({ base, force }))).toEqual([{ base: null, force: true }, { base: null, force: true }])
  })

  it('always sends named files but only changed files from named directories', async () => {
    const { mirror, manifest } = await pulled()
    const named = await planItems({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects/Same.md')], force: false })
    expect(named).toEqual([{ local: join(mirror, 'Projects/Same.md'), remote: 'Projects/Same.md', base: { nodeId: 'n2', version: 'v2' }, sha256: sha('same') }])
    const directory = await planItems({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects')], force: false })
    expect(directory.map((item) => item.remote)).toEqual(['Projects/New.txt', 'Projects/Plan.md'])
  })

  it('refuses copies of moved or trashed items unless --to says where they go', async () => {
    const { mirror, manifest } = await pulled()
    const local = join(mirror, 'Projects/Plan.md')
    delete manifest.files[local]
    manifest.moved[local] = { remote: 'Projects/Plan.md', to: 'Archive' }

    const plain = await planPush({ mirrorRoot: mirror, manifest, locals: [], force: false })
    expect(plain.items.map((item) => item.remote)).toEqual(['Projects/New.txt'])
    expect(plain.refused).toEqual([{ local, remote: 'Projects/Plan.md', message: expect.stringContaining('was moved in Files (to "Archive")') }])
    expect((await planPush({ mirrorRoot: mirror, manifest, locals: [local], force: true })).refused).toHaveLength(1)
    expect(await planPush({ mirrorRoot: mirror, manifest, locals: [local], to: 'Archive/Plan.md', force: false }))
      .toEqual({ refused: [], items: [{ local, remote: 'Archive/Plan.md', base: null, sha256: sha('edited') }] })
    manifest.moved[local] = { remote: 'Projects/Plan.md', to: null }
    expect((await planPush({ mirrorRoot: mirror, manifest, locals: [join(mirror, 'Projects')], force: false })).refused[0]?.message).toContain('moved to the trash')
  })

  it('needs --to for files outside the mirror that were never pulled', async () => {
    const { mirror, root, manifest } = await pulled()
    await expect(planPush({ mirrorRoot: mirror, manifest, locals: [join(root, 'report.pdf')], force: false })).rejects.toThrow(UsageError)
    expect(await planItems({ mirrorRoot: mirror, manifest, locals: [join(root, 'report.pdf')], to: 'Projects/', force: false }))
      .toEqual([{ local: join(root, 'report.pdf'), remote: 'Projects/report.pdf', base: null, sha256: sha('pdf') }])
    expect((await planItems({ mirrorRoot: mirror, manifest, locals: [join(root, 'report.pdf')], to: '/Reports/q3.pdf', force: false }))[0]?.remote).toBe('Reports/q3.pdf')
  })

  it('keeps the base only when --to names the pulled item itself', async () => {
    const { mirror, manifest } = await pulled()
    const local = join(mirror, 'Projects/Plan.md')
    expect((await planItems({ mirrorRoot: mirror, manifest, locals: [local], to: 'projects/plan.md', force: false }))[0]?.base).toEqual({ nodeId: 'n1', version: 'v1' })
    expect((await planItems({ mirrorRoot: mirror, manifest, locals: [local], to: 'Projects/Copy.md', force: false }))[0]?.base).toBeNull()
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
