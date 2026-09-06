import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShelfMutation, ShelfSnapshot } from '@pulpo/contracts'
import { ShelfSync, emptyShelf, type ShelfCheckpoint, type ShelfHandoff, type ShelfPorts } from './shelf.js'

const instances: ShelfSync[] = []
afterEach(() => { instances.splice(0).forEach((shelf) => shelf.dispose()) })
function fixture() {
  let disk: ShelfCheckpoint = emptyShelf()
  let composer: ShelfHandoff['after'] = { content: '', attachments: [] }
  let online = false, failStorage = false, loseAck = false, failUpload = false
  let remote: ShelfSnapshot = { revision: 0, drafts: [] }
  const seen = new Set<string>(), consumed = new Set<string>()
  let tail = Promise.resolve()
  const ports: ShelfPorts = {
    uuid: randomUUID,
    lock: (work) => { const next = tail.then(work, work); tail = next.then(() => undefined, () => undefined); return next },
    load: async () => structuredClone(disk),
    save: async (next, handoff) => { if (failStorage) throw new Error('Disk full'); disk = structuredClone(next); if (handoff) composer = structuredClone(handoff.after) },
    read: async () => { if (!online) throw new Error('offline'); return structuredClone(remote) },
    upload: vi.fn(async () => { if (failUpload) throw new Error('Upload rejected'); return randomUUID() }),
    mutate: vi.fn(async (input: ShelfMutation) => {
      if (!online) throw new Error('offline')
      if (!seen.has(input.operationId)) {
        const action = input.action
        const draft = action.type === 'save' ? action.draft : action.type === 'restore' ? action.replacement : undefined
        if (draft && !consumed.has(draft.id) && !remote.drafts.some((row) => row.id === draft.id)) {
          const row = { id: draft.id, content: draft.content, attachments: draft.attachmentIds.map((id) => ({ id, name: 'image.png', mimeType: 'image/png', size: 3 })), createdAt: '', updatedAt: '', revision: remote.revision + 1, position: 0 }
          const index = action.type === 'restore' ? remote.drafts.findIndex((item) => item.id === action.id) : -1
          remote.drafts.splice(Math.max(0, index), 0, row)
        }
        if (action.type === 'delete' || action.type === 'restore') { consumed.add(action.id); remote.drafts = remote.drafts.filter((row) => row.id !== action.id) }
        seen.add(input.operationId); remote.revision++
      }
      if (loseAck) { loseAck = false; throw new Error('network connection lost') }
      return structuredClone(remote)
    }),
  }
  const create = () => { const shelf = new ShelfSync(ports); instances.push(shelf); return shelf }
  const shelf = create()
  const settle = async () => { await shelf.sync(); await vi.waitFor(() => expect(disk.operations).toHaveLength(0)) }
  return { shelf, create, ports, settle, disk: () => disk, composer: () => composer,
    online: () => { online = true }, failStorage: () => { failStorage = true }, loseAck: () => { loseAck = true }, failUpload: () => { failUpload = true } }
}

describe('durable shelf transfers', () => {
  it('keeps retrying connectivity after an explicit offline refresh', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      const reads = vi.spyOn(f.ports, 'read')
      await f.shelf.shelve('offline', [])
      await f.shelf.sync()
      await f.shelf.sync()
      const before = reads.mock.calls.length
      await vi.advanceTimersByTimeAsync(15_001)
      expect(reads.mock.calls.length).toBeGreaterThan(before)
      f.shelf.dispose()
    } finally { vi.useRealTimers() }
  })
  it('commits exact prompt and local file before clearing the composer', async () => {
    const f = fixture()
    const attachments = [{ localId: 'local', name: 'image.png', mimeType: 'image/png', size: 3, source: 'durable://image' }]
    await f.shelf.shelve('  unfinished\n\n', attachments)
    expect(f.disk().operations[0]?.action).toMatchObject({ type: 'save', draft: { content: '  unfinished\n\n', attachments } })
    expect(f.composer()).toEqual({ content: '', attachments: [] })
    expect(f.shelf.getSnapshot()[0]?.status).toBe('pending')
  })
  it('does not clear the composer or publish a shelf item when storage fails', async () => {
    const f = fixture(); f.failStorage()
    await expect(f.shelf.shelve('keep me', [])).rejects.toThrow('Disk full')
    expect(f.disk().operations).toEqual([])
    expect(f.shelf.getSnapshot()).toEqual([])
  })
  it('rejects a stale composer owner before saving or consuming either draft', async () => {
    const f = fixture()
    await expect(f.shelf.shelve('new typing', [], () => false)).rejects.toThrow('composer changed')
    expect(f.disk().operations).toEqual([])
    const id = await f.shelf.shelve('saved', [])
    await expect(f.shelf.restore(id, { content: 'new typing', attachments: [] }, () => false)).rejects.toThrow('composer changed')
    expect(f.shelf.getSnapshot().map((row) => row.content)).toEqual(['saved'])
    expect(f.disk().operations).toHaveLength(1)
  })
  it('swaps in the selected position without losing either prompt', async () => {
    const f = fixture()
    const a = await f.shelf.shelve('first', [])
    await f.shelf.shelve('second', [])
    const restored = await f.shelf.restore(a, { content: 'outgoing', attachments: [] })
    expect(restored.content).toBe('first')
    expect(f.composer().content).toBe('first')
    expect(f.shelf.getSnapshot().map((row) => row.content)).toEqual(['second', 'outgoing'])
  })
  it('restores attachment-only drafts and rejects whitespace-only empty drafts', async () => {
    const f = fixture()
    await expect(f.shelf.shelve(' \n ', [])).rejects.toThrow('Add text')
    const id = await f.shelf.shelve('', [{ localId: 'a', id: randomUUID(), name: 'one.pdf', mimeType: 'application/pdf', size: 9 }])
    const restored = await f.shelf.restore(id, { content: '', attachments: [] })
    expect(restored.attachments[0]?.name).toBe('one.pdf')
    expect(f.shelf.getSnapshot()).toEqual([])
  })
  it('restarts with durable pending files, uploads them, and retains their offline source after acceptance', async () => {
    const f = fixture()
    await f.shelf.shelve('unfinished', [{ localId: 'a', source: 'durable://image', name: 'image.png', mimeType: 'image/png', size: 3 }])
    f.shelf.dispose(); f.online()
    const restarted = f.create(); await restarted.hydrate(); await restarted.sync()
    expect(restarted.getSnapshot()[0]?.attachments[0]).toMatchObject({ source: 'durable://image' })
    expect(restarted.getSnapshot()[0]?.status).toBeUndefined()
    expect(f.ports.upload).toHaveBeenCalledTimes(1)
    const restored = await restarted.restore(restarted.getSnapshot()[0]!.id, { content: '', attachments: [] })
    expect(restored.attachments[0]?.source).toBe('durable://image')
  })
  it('does not resurrect a consumed item when a successful save acknowledgement is lost', async () => {
    const f = fixture(); const id = await f.shelf.shelve('restore me', [])
    f.online(); f.loseAck(); await f.shelf.sync()
    await f.shelf.restore(id, { content: '', attachments: [] }); await f.settle()
    expect(f.shelf.getSnapshot()).toEqual([])
    expect(f.composer().content).toBe('restore me')
  })
  it('allows deletion of failed uploads without uploading them again', async () => {
    const f = fixture(); const id = await f.shelf.shelve('failed file', [{ localId: 'a', name: 'image.png', mimeType: 'image/png', size: 3, source: 'durable://image' }])
    f.online(); f.failUpload(); await f.shelf.sync()
    await vi.waitFor(() => expect(f.shelf.getSnapshot()[0]?.status).toBe('failed'))
    await f.shelf.delete(id); await f.settle()
    expect(f.shelf.getSnapshot()).toEqual([])
    expect(f.ports.upload).toHaveBeenCalledTimes(1)
  })
  it('restores a failed pending replacement without blocking later operations', async () => {
    const f = fixture(); const id = await f.shelf.shelve('first', [])
    f.online(); await f.settle()
    await f.shelf.restore(id, { content: 'replacement', attachments: [{ localId: 'a', name: 'image.png', mimeType: 'image/png', size: 3, source: 'durable://image' }] })
    f.failUpload(); await f.shelf.sync()
    const replacement = f.shelf.getSnapshot()[0]!
    await f.shelf.restore(replacement.id, { content: '', attachments: [] }); await f.settle()
    expect(f.composer().content).toBe('replacement')
  })
  it('persists manual order and ignores a missing reorder target', async () => {
    const f = fixture(); const a = await f.shelf.shelve('a', []); const b = await f.shelf.shelve('b', [])
    await f.shelf.reorder(a, b, 'before')
    await f.shelf.reorder(b, 'gone', 'before')
    expect(f.shelf.getSnapshot().map((row) => row.id)).toEqual([a, b])
    const reopened = f.create(); await reopened.hydrate()
    expect(reopened.getSnapshot().map((row) => row.id)).toEqual([a, b])
  })
})
