import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheComposerDraft, cachedComposerDraft, clearComposerDraftCacheNamespace, composerDraftScope } from './composerDraftCache'
import { submitComposerDraft, type SubmissionDraft } from './composerSubmission'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const scope = composerDraftScope('submission-test', 'chat')
afterEach(() => clearComposerDraftCacheNamespace('submission-test'))

function fixture() {
  const submitted: SubmissionDraft = { scope, body: 'queue this', attachments: [{ localId: 'image' }] }
  let current = submitted
  const prepare = deferred<number>(), send = deferred<boolean>()
  const disk = new Map<string, { body: string; attachments: readonly { localId: string }[] }>()
  const edit = (patch: Partial<SubmissionDraft>) => {
    current = { ...current, ...patch }
    if (current.scope) {
      cacheComposerDraft(current.scope, { body: current.body, attachments: [...current.attachments] })
      disk.set(current.scope, { body: current.body, attachments: current.attachments })
    }
  }
  edit({})
  const clear = vi.fn(() => edit({ body: '', attachments: [] }))
  const restore = vi.fn(() => edit(submitted))
  const complete = vi.fn(async () => {})
  const canRestore = vi.fn(() => true)
  const sendMessage = vi.fn(() => send.promise)
  const run = () => submitComposerDraft({ submitted, current: () => current, prepare: () => prepare.promise,
    send: sendMessage, clear, restore, complete, canRestore })
  return { submitted, prepare, send, edit, clear, restore, complete, canRestore, sendMessage, run,
    current: () => current, disk, cached: () => cachedComposerDraft(scope),
    start: async () => {
      const pending = run()
      prepare.resolve(7)
      await Promise.resolve()
      return { pending }
    },
  }
}

describe('mobile submission draft ownership', () => {
  it('clears a queued message before acceptance without waiting for an assistant token', async () => {
    const f = fixture()
    const { pending } = await f.start()
    expect(f.sendMessage).toHaveBeenCalledOnce()
    expect(f.current()).toMatchObject({ body: '', attachments: [] })
    expect(f.cached()).toEqual({ body: '', attachments: [] })
    f.send.resolve(true)
    expect(await pending).toBe(true)
    expect(f.complete).toHaveBeenCalledWith(7)
  })

  it.each([
    { body: 'newer text' },
    { attachments: [{ localId: 'new-image' }] },
    { scope: composerDraftScope('submission-test', 'other-chat') },
  ])('preserves edits or navigation during draft preparation (%j)', async (patch) => {
    const f = fixture()
    const pending = f.run()
    f.edit(patch)
    f.prepare.resolve(7)
    f.send.resolve(true)
    await pending
    expect(f.clear).not.toHaveBeenCalled()
    expect(f.current()).toMatchObject(patch)
  })

  it('preserves a newer runtime and disk draft when the queue request is accepted', async () => {
    const f = fixture()
    const { pending } = await f.start()
    f.edit({ body: 'next question', attachments: [{ localId: 'next-image' }] })
    f.send.resolve(true)
    await pending
    expect(f.cached()).toEqual({ body: 'next question', attachments: [{ localId: 'next-image' }] })
    expect(f.disk.get(scope)).toEqual(f.cached())
  })

  it.each(['rejected', 'throws'])('restores an empty composer when sending %s', async (failure) => {
    const f = fixture()
    const { pending } = await f.start()
    if (failure === 'throws') {
      f.send.reject(new Error('offline'))
      await expect(pending).rejects.toThrow('offline')
    } else {
      f.send.resolve(false)
      expect(await pending).toBe(false)
    }
    expect(f.current()).toEqual(f.submitted)
    expect(f.complete).not.toHaveBeenCalled()
  })

  it.each([
    { body: 'next question' },
    { attachments: [{ localId: 'next-image' }] },
    { scope: composerDraftScope('submission-test', 'another-empty-chat') },
  ])('does not overwrite a newer local draft on failure with sync disabled (%j)', async (patch) => {
    const f = fixture()
    const { pending } = await f.start()
    f.edit(patch)
    f.send.reject(new Error('offline'))
    await expect(pending).rejects.toThrow('offline')
    expect(f.restore).not.toHaveBeenCalled()
    expect(f.current()).toMatchObject(patch)
  })

  it('honors a remotely replaced draft when deciding whether to restore', async () => {
    const f = fixture()
    const { pending } = await f.start()
    f.canRestore.mockReturnValue(false)
    f.send.resolve(false)
    await pending
    expect(f.restore).not.toHaveBeenCalled()
  })

  it('does not restore an accepted message if draft completion fails', async () => {
    const f = fixture()
    f.complete.mockRejectedValue(new Error('draft storage unavailable'))
    const { pending } = await f.start()
    f.send.resolve(true)
    await expect(pending).rejects.toThrow('draft storage unavailable')
    expect(f.restore).not.toHaveBeenCalled()
  })
})
