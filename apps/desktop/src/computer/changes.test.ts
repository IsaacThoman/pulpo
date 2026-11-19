import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangesStore } from './changes'

const account = { origin: 'https://pulpo.example', userId: '00000000-0000-4000-8000-00000000000a' }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

describe('ChangesStore', () => {
  let base: string
  let folder: string
  let granted: boolean
  let clock: number
  let onChanged: ReturnType<typeof vi.fn<() => void>>
  let store: ChangesStore

  beforeEach(async () => {
    base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pulpo-changes-')))
    folder = path.join(base, 'folder')
    await mkdir(folder)
    granted = true
    clock = Date.parse('2026-11-18T12:00:00Z')
    onChanged = vi.fn<() => void>()
    store = new ChangesStore({ root: path.join(base, 'changes'), onChanged, folderGranted: async () => granted, trash: async () => undefined, now: () => clock })
  })

  afterEach(async () => { await rm(base, { recursive: true, force: true }) })

  const suggestFile = (file: string, content: string) => store.suggest(account, { sessionId: randomUUID(), responseId: randomUUID(), folder, path: file, kind: 'create', sizeBytes: content.length }, {
    source: Readable.from([Buffer.from(content)]), sha256: sha(content), sizeBytes: content.length, diskBase: null,
  })

  it('persists suggestions and tells the renderer', async () => {
    const change = await suggestFile('a.txt', 'hello')
    expect(change).toMatchObject({ path: 'a.txt', status: 'pending', kind: 'create', folder })
    expect(change).not.toHaveProperty('sha256')
    expect(onChanged).toHaveBeenCalledTimes(1)
    const reopened = new ChangesStore({ root: path.join(base, 'changes'), onChanged, folderGranted: async () => true, trash: async () => undefined })
    expect((await reopened.list(account)).map((entry) => entry.id)).toEqual([change.id])
    expect((await reopened.pendingFiles(account, folder)).get('a.txt')?.sha256).toBe(sha('hello'))
  })

  it('refuses to accept into a folder that is no longer allowed', async () => {
    const change = await suggestFile('a.txt', 'hello')
    granted = false
    await expect(store.accept(account, [change.id])).rejects.toThrow(/no longer allowed/)
    await expect(stat(path.join(folder, 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await store.list(account))[0]!.status).toBe('pending')
  })

  it('refuses a suggestion whose bytes do not match', async () => {
    await expect(store.suggest(account, { sessionId: randomUUID(), responseId: randomUUID(), folder, path: 'b.txt', kind: 'create' }, {
      source: Readable.from([Buffer.from('other')]), sha256: sha('hello'), sizeBytes: 5, diskBase: null,
    })).rejects.toThrow(/checksum/)
    expect(await store.list(account)).toEqual([])
  })

  it('prunes decided changes after 30 days and keeps recent undecided ones', async () => {
    const old = await suggestFile('old.txt', 'old')
    await store.accept(account, [old.id])
    expect(await readFile(path.join(folder, 'old.txt'), 'utf8')).toBe('old')
    clock += 31 * 24 * 60 * 60_000
    const kept = await suggestFile('kept.txt', 'kept')
    await store.prune()
    expect((await store.list(account)).map((entry) => entry.id)).toEqual([kept.id])
  })

  it('rejects a suggestion nobody decided for 30 days, so the agent stops seeing it as accepted', async () => {
    const forgotten = await suggestFile('forgotten.txt', 'never reviewed')
    expect((await store.pendingFiles(account, folder)).has('forgotten.txt')).toBe(true)
    clock += 31 * 24 * 60 * 60_000
    await store.prune()
    expect((await store.pendingFiles(account, folder)).size).toBe(0)
    expect(await store.list(account)).toMatchObject([{ id: forgotten.id, status: 'rejected' }])
    await expect(stat(store.blobPath(account, forgotten.id))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await stat(path.join(folder, 'forgotten.txt')).catch(() => null)).toBeNull()
  })
})
