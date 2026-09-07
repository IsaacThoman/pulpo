import { beforeEach, expect, it, vi } from 'vitest'
import { listenForShortcutLinks, useShortcutInbox } from './inbox'
const url = (n: number) => `pulpo://shortcuts?action=new-chat&scope=${'a'.repeat(64)}&requestId=00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
beforeEach(() => useShortcutInbox.setState({ pending: [] }))
it('retains links received before login and deduplicates cold/warm delivery', async () => {
  let onURL: ((event: { url: string }) => void) | undefined
  const remove = vi.fn()
  const stop = listenForShortcutLinks({
    addEventListener: (_type, callback) => { onURL = callback; return { remove } },
    getInitialURL: async () => url(1),
  })
  onURL!({ url: url(1) })
  await Promise.resolve()
  expect(useShortcutInbox.getState().pending).toHaveLength(1)
  const requestId = useShortcutInbox.getState().pending[0]!.requestId
  useShortcutInbox.getState().acknowledge(requestId)
  onURL!({ url: url(1) })
  expect(useShortcutInbox.getState().pending).toHaveLength(0)
  stop()
  expect(remove).toHaveBeenCalledOnce()
})
it('ignores late initial URLs after listener disposal', async () => {
  let resolve!: (url: string) => void
  const stop = listenForShortcutLinks({ addEventListener: () => ({ remove() {} }), getInitialURL: () => new Promise((done) => { resolve = done }) })
  stop(); resolve(url(2)); await Promise.resolve()
  expect(useShortcutInbox.getState().pending).toHaveLength(0)
})
it('bounds incoming navigation requests and rejects arbitrary links', () => {
  for (let n = 100; n < 130; n++) useShortcutInbox.getState().receive(url(n))
  useShortcutInbox.getState().receive('https://pulpo.baby')
  expect(useShortcutInbox.getState().pending).toHaveLength(16)
})
it('does not navigate back to an older cold link after a newer warm link', async () => {
  let resolve!: (url: string) => void
  let onURL!: (event: { url: string }) => void
  const stop = listenForShortcutLinks({
    addEventListener: (_type, callback) => { onURL = callback; return { remove() {} } },
    getInitialURL: () => new Promise((done) => { resolve = done }),
  })
  onURL({ url: url(40) }); resolve(url(39)); await Promise.resolve()
  expect(useShortcutInbox.getState().pending.map((item) => item.requestId)).toEqual(['00000000-0000-4000-8000-000000000040'])
  stop()
})
