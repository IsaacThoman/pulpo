import { describe, expect, it, vi } from 'vitest'
import { IncomingFileQueue, type IncomingFile } from './incomingFileQueue'
import type { ImportedFile } from '../../../modules/pulpo-file-import'

const file: ImportedFile = { uri: 'file:///owned/uuid/photo.heic', name: 'photo.heic', mimeType: 'image/heic', size: 42 }
function fixture(initial: IncomingFile[] = []) {
  let disk = initial
  let id = 0
  const deps = {
    uuid: () => `id-${++id}`,
    load: async () => disk,
    save: vi.fn(async (items: IncomingFile[]) => { disk = structuredClone(items) }),
    copy: vi.fn(async () => file),
    release: vi.fn(),
  }
  const queue = new IncomingFileQueue(deps)
  return { queue, deps, disk: () => disk }
}

describe('incoming file ownership', () => {
  it('can retry after a transient storage read failure', async () => {
    const f = fixture()
    vi.spyOn(f.deps, 'load').mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(f.queue.enqueue('file:///photo')).rejects.toThrow('Storage unavailable')
    await f.queue.enqueue('file:///photo')
    expect(f.queue.getSnapshot()[0]?.file).toEqual(file)
  })
  it('retains imports during startup/login, binds on login and persists their original metadata', async () => {
    const f = fixture()
    await f.queue.enqueue('file:///Inbox/photo.heic')
    expect(f.disk()[0]).toMatchObject({ namespace: null, file })
    await f.queue.setIdentity('instance|alice')
    expect(f.queue.getSnapshot()[0]).toMatchObject({ namespace: 'instance|alice', file })
    const restored = fixture(f.disk())
    await restored.queue.setIdentity('instance|alice')
    expect(restored.queue.getSnapshot()).toEqual(f.queue.getSnapshot())
  })

  it('coalesces duplicate pending delivery but allows deliberately reopening a consumed file', async () => {
    const f = fixture()
    await Promise.all([f.queue.enqueue('file:///same'), f.queue.enqueue('file:///same')])
    expect(f.deps.copy).toHaveBeenCalledTimes(1)
    const first = f.queue.getSnapshot()[0]!
    await f.queue.finish(first.id, true)
    expect(f.deps.release).not.toHaveBeenCalled()
    await f.queue.enqueue('file:///same')
    expect(f.queue.getSnapshot()[0]!.id).not.toBe(first.id)
  })

  it('releases rejected files and persists removal', async () => {
    const f = fixture()
    await f.queue.enqueue('file:///large')
    await f.queue.finish(f.queue.getSnapshot()[0]!.id, false)
    expect(f.deps.release).toHaveBeenCalledWith(file)
    expect(f.disk()).toEqual([])
  })

  it('releases a copied file if staging cannot be persisted', async () => {
    const f = fixture()
    f.deps.save.mockRejectedValue(new Error('Disk full'))
    await expect(f.queue.enqueue('file:///photo')).rejects.toThrow('Disk full')
    expect(f.queue.getSnapshot()).toEqual([])
    expect(f.deps.release).toHaveBeenCalledWith(file)
  })

  it('does not move a queued file into another account', async () => {
    const f = fixture()
    await f.queue.setIdentity('alice')
    await f.queue.enqueue('file:///private')
    await f.queue.setIdentity('bob')
    expect(f.queue.getSnapshot()).toEqual([])
    expect(f.deps.release).toHaveBeenCalledWith(file)
  })

  it('retains an in-flight import in its original profile across switching and restart', async () => {
    const f = fixture()
    let complete!: (file: ImportedFile) => void
    f.deps.copy.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    await f.queue.setIdentity('instance|alice')
    const copying = f.queue.enqueue('file:///personal')
    await vi.waitFor(() => expect(complete).toBeDefined())
    await f.queue.setIdentity('instance|alice|profile:work')
    complete(file)
    await copying
    expect(f.queue.getSnapshot()[0]).toMatchObject({ namespace: 'instance|alice', file })
    expect(f.deps.release).not.toHaveBeenCalled()
    const restored = fixture(f.disk())
    await restored.queue.setIdentity('instance|alice|profile:work')
    expect(restored.queue.getSnapshot()[0]?.namespace).toBe('instance|alice')
    await restored.queue.setIdentity('instance|alice')
    expect(restored.queue.getSnapshot()[0]?.file).toEqual(file)
  })

  it('releases imports from a deleted profile while retaining other profiles', async () => {
    const f = fixture()
    await f.queue.setIdentity('instance|alice|profile:work')
    await f.queue.enqueue('file:///work')
    await f.queue.setIdentity('instance|alice', new Set(['instance|alice']))
    expect(f.queue.getSnapshot()).toEqual([])
    expect(f.deps.release).toHaveBeenCalledWith(file)
  })

  it('releases a late native copy if logout occurred during copying', async () => {
    const f = fixture()
    let complete!: (file: ImportedFile) => void
    f.deps.copy.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    await f.queue.setIdentity('alice')
    const copying = f.queue.enqueue('file:///private')
    await vi.waitFor(() => expect(complete).toBeDefined())
    await f.queue.setIdentity(null)
    complete(file)
    await copying
    expect(f.queue.getSnapshot()).toEqual([])
    expect(f.deps.release).toHaveBeenCalledWith(file)
  })

  it('delivers readable errors after login without inventing an attachment', async () => {
    const f = fixture()
    f.deps.copy.mockRejectedValue(new Error('Attachment is empty'))
    await f.queue.enqueue('file:///empty')
    await f.queue.setIdentity('alice')
    expect(f.queue.getSnapshot()[0]).toMatchObject({ error: 'Attachment is empty', namespace: 'alice' })
    expect(f.queue.getSnapshot()[0]?.file).toBeUndefined()
  })
})
