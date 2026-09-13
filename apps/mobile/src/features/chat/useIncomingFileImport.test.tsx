// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncomingFileQueue, type IncomingFile } from './incomingFileQueue'
import { useIncomingFileImport } from './useIncomingFileImport'
import { incomingFileAttachment } from './incomingFileAttachment'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()) })

async function fixture() {
  let id = 0
  const release = vi.fn()
  const queue = new IncomingFileQueue({
    uuid: () => String(++id), load: async () => [], save: async () => {}, release,
    copy: async (source) => ({ uri: `file:///owned/${++id}`, name: source.split('/').pop()!, mimeType: 'image/heic', size: 42 }),
  })
  const draft = { body: 'existing new-chat text', attachments: [{ localId: 'existing', name: 'old.pdf' }] }
  const report = vi.fn()
  const save = vi.fn(async () => {})
  const accept = vi.fn((item: IncomingFile) => {
    const prepared = incomingFileAttachment(item, draft.attachments)
    if (prepared.error) { report(prepared.error); return { accepted: false, saved: Promise.resolve() } }
    if (prepared.attachment) draft.attachments.push(prepared.attachment)
    return { accepted: true, saved: save() }
  })
  function Consumer({ ready, namespace }: { ready: boolean; namespace: string | null }) {
    useIncomingFileImport(queue, { ready, namespace, accept, report })
    return null
  }
  root = createRoot(document.createElement('div'))
  const render = (ready: boolean, namespace: string | null = 'alice') => act(async () => {
    root!.render(createElement(StrictMode, {}, createElement(Consumer, { ready, namespace })))
  })
  const enqueue = (...names: string[]) => act(async () => {
    await Promise.all(names.map((name) => queue.enqueue(`file:///Inbox/${name}`)))
  })
  await queue.setIdentity('alice')
  return { queue, release, draft, report, save, accept, render, enqueue }
}

describe('importing into a hydrated new-chat composer', () => {
  it('waits for navigation/edit completion and hydration, appends without replacing text, and tolerates StrictMode', async () => {
    const f = await fixture()
    await f.render(false)
    await f.enqueue('photo.heic')
    expect(f.accept).not.toHaveBeenCalled()
    await f.render(true)
    expect(f.accept).toHaveBeenCalledTimes(1)
    expect(f.draft.body).toBe('existing new-chat text')
    expect(f.draft.attachments.map((a) => a.name)).toEqual(['old.pdf', 'photo.heic'])
    await f.render(true)
    expect(f.accept).toHaveBeenCalledTimes(1)
    expect(f.queue.getSnapshot()).toEqual([])
    expect(f.release).not.toHaveBeenCalled()
  })

  it('handles rapid imports against the current composer count and releases overflow', async () => {
    const f = await fixture()
    await f.render(true)
    await f.enqueue(...Array.from({ length: 501 }, (_, index) => String(index)))
    expect(f.draft.attachments).toHaveLength(500)
    expect(f.release).toHaveBeenCalledTimes(2)
    expect(f.report).toHaveBeenCalledWith('You can attach up to 500 items.')
  })

  it('keeps the import queued until the draft save succeeds', async () => {
    const f = await fixture()
    let saved!: () => void
    f.save.mockImplementation(() => new Promise((resolve) => { saved = resolve }))
    await f.render(true)
    await f.enqueue('photo.heic')
    expect(f.queue.getSnapshot()).toHaveLength(1)
    await f.render(true)
    expect(f.accept).toHaveBeenCalledTimes(1)
    await act(async () => { saved() })
    expect(f.queue.getSnapshot()).toEqual([])
  })

  it('never consumes another account’s pending file', async () => {
    const f = await fixture()
    await f.render(false)
    await f.enqueue('private.heic')
    await f.render(true, 'bob')
    expect(f.accept).not.toHaveBeenCalled()
  })

  it('replay after a crash acknowledges the file already in the restored draft', async () => {
    const f = await fixture()
    await f.render(false)
    await f.enqueue('photo.heic')
    f.draft.attachments.push({ localId: `import:${f.queue.getSnapshot()[0]!.id}`, name: 'photo.heic' })
    await f.render(true)
    expect(f.draft.attachments).toHaveLength(2)
    expect(f.queue.getSnapshot()).toEqual([])
    expect(f.release).not.toHaveBeenCalled()
  })
})

describe('file types and validation', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'image'], ['photo.png', 'image/png', 'image'],
    ['photo.heic', 'image/heic', 'image'], ['photo.gif', 'image/gif', 'image'],
    ['report.pdf', 'application/pdf', 'file'], ['notes.txt', 'text/plain', 'file'],
    ['archive.zip', 'application/zip', 'file'], ['data.unknown', 'application/octet-stream', 'file'],
    ['LICENSE', 'application/octet-stream', 'file'],
  ])('accepts %s preserving bytes and metadata', (name, mimeType, kind) => {
    const file = { uri: 'file:///owned/original', name, mimeType, size: 42 }
    const result = incomingFileAttachment({ id: 'id', source: '', namespace: 'alice', file }, [])
    expect(result.attachment).toMatchObject({ ...file, kind, localId: 'import:id', state: 'local' })
  })
  it.each([[0, 'Attachment is empty'], [101, 'Attachment exceeds']])('rejects invalid size %s', (size, message) => {
    const item = { id: 'id', source: '', namespace: 'alice', file: { uri: '', name: 'file', mimeType: 'application/octet-stream', size } }
    expect(incomingFileAttachment(item, [], 100).error).toContain(message)
  })
})
