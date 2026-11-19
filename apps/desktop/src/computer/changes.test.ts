import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangesStore } from './changes'

/** Lets a test act at the moment a suggested file has been copied beside its target, before it takes its place. */
const copies = vi.hoisted(() => ({ afterCopy: undefined as (() => Promise<void>) | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => { await actual.copyFile(...args); await copies.afterCopy?.() },
  }
})

const account = { origin: 'https://pulpo.example', userId: '00000000-0000-4000-8000-00000000000a' }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

describe('ChangesStore', () => {
  let base: string
  let folder: string
  let granted: boolean
  let clock: number
  let onChanged: ReturnType<typeof vi.fn<() => void>>
  let store: ChangesStore
  let trash: ReturnType<typeof vi.fn<(target: string) => Promise<void>>>

  beforeEach(async () => {
    base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pulpo-changes-')))
    folder = path.join(base, 'folder')
    await mkdir(folder)
    granted = true
    clock = Date.parse('2026-11-18T12:00:00Z')
    onChanged = vi.fn<() => void>()
    trash = vi.fn(async (target: string) => { await rm(target, { recursive: true }) })
    store = new ChangesStore({ root: path.join(base, 'changes'), onChanged, folderGranted: async () => granted, trash, now: () => clock })
  })

  afterEach(async () => { copies.afterCopy = undefined; await rm(base, { recursive: true, force: true }) })

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

  it('reports a conflict when the user saves the file while an accepted suggestion is being copied in', async () => {
    const target = path.join(folder, 'a.txt')
    await writeFile(target, 'original')
    const change = await store.suggest(account, { sessionId: randomUUID(), responseId: randomUUID(), folder, path: 'a.txt', kind: 'update', sizeBytes: 9 }, {
      source: Readable.from([Buffer.from('suggested')]), sha256: sha('suggested'), sizeBytes: 9, diskBase: sha('original'),
    })
    copies.afterCopy = async () => { await writeFile(target, 'saved meanwhile') }
    expect((await store.accept(account, [change.id]))[0]).toMatchObject({ id: change.id, status: 'conflict' })
    expect(await readFile(target, 'utf8')).toBe('saved meanwhile')
    // Nothing is left behind beside the file.
    expect(await readdir(folder)).toEqual(['a.txt'])

    // Overwriting is the user's own choice, whatever is there by then.
    copies.afterCopy = async () => { await writeFile(target, 'saved again') }
    expect((await store.accept(account, [change.id], { overwrite: true }))[0]).toMatchObject({ status: 'accepted' })
    expect(await readFile(target, 'utf8')).toBe('suggested')
  })

  it('does not remove what was put into a folder suggested for removal while it was empty', async () => {
    const remove = (name: string, recursive: boolean) => store.suggest(account, { sessionId: randomUUID(), responseId: randomUUID(), folder, path: name, kind: 'remove', recursive })
    await mkdir(path.join(folder, 'empty'))
    await mkdir(path.join(folder, 'whole'))
    const empty = await remove('empty', false)
    const whole = await remove('whole', true)
    expect(empty).not.toHaveProperty('recursive')
    // The user keeps working in both before deciding.
    await writeFile(path.join(folder, 'empty', 'new.txt'), 'added since')
    await writeFile(path.join(folder, 'whole', 'new.txt'), 'added since')

    expect((await store.accept(account, [empty.id]))[0]).toMatchObject({ status: 'conflict' })
    expect(trash).not.toHaveBeenCalled()
    expect(await readFile(path.join(folder, 'empty', 'new.txt'), 'utf8')).toBe('added since')
    // A folder suggested with its contents goes as a whole, and so does the other once the user says so.
    expect((await store.accept(account, [whole.id]))[0]).toMatchObject({ status: 'accepted' })
    expect((await store.accept(account, [empty.id], { overwrite: true }))[0]).toMatchObject({ status: 'accepted' })
    expect(trash.mock.calls.map(([target]) => path.basename(target))).toEqual(['whole', 'empty'])

    // Still empty when accepted: nothing stands in the way.
    await mkdir(path.join(folder, 'bare'))
    expect((await store.accept(account, [(await remove('bare', false)).id]))[0]).toMatchObject({ status: 'accepted' })
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
