// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { applyMarkdownToYDoc } from '@pulpo/client-core/doc-schema'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { useDocSession } from './use-doc-session'

const caches = vi.hoisted(() => [] as Array<{ doc: Y.Doc; resolve: () => void }>)
vi.mock('y-indexeddb', () => ({ IndexeddbPersistence: class {
  whenSynced: Promise<void>
  constructor(_name: string, doc: Y.Doc) {
    this.whenSynced = new Promise((resolve) => { caches.push({ doc, resolve }) })
  }
  destroy() { return Promise.resolve() }
} }))

beforeEach(() => { vi.useFakeTimers(); caches.length = 0 })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('does not mistake the editor initializing its empty paragraph for an offline copy', async () => {
  const { result, rerender } = renderHook(() => useDocSession('owner', 'doc-1'))
  await act(async () => caches[0]!.resolve())
  expect(result.current.session?.hasCachedContent).toBe(false)
  const doc = result.current.session!.doc
  doc.getXmlFragment('default').push([new Y.XmlElement('paragraph')])
  rerender()
  expect(result.current.session?.hasCachedContent).toBe(false)
})

it('allows a cached document to be used while the socket is offline', async () => {
  const { result } = renderHook(() => useDocSession('owner', 'doc-1'))
  applyMarkdownToYDoc(caches[0]!.doc, '# Offline copy')
  await act(async () => caches[0]!.resolve())
  expect(result.current.session?.hasCachedContent).toBe(true)
  expect(result.current.status.state).toBe('offline')
})

it('recognizes a cached document that loads after the initial wait has expired', async () => {
  const { result } = renderHook(() => useDocSession('owner', 'doc-1'))
  act(() => vi.advanceTimersByTime(1_501))
  expect(result.current.session).toBeNull()
  applyMarkdownToYDoc(caches[0]!.doc, 'Late offline edits')
  await act(async () => caches[0]!.resolve())
  expect(result.current.session?.hasCachedContent).toBe(true)
})

it('does not mount a default editor or invent a cached copy after a late empty cache loads', async () => {
  const { result } = renderHook(() => useDocSession('owner', 'doc-1'))
  act(() => vi.advanceTimersByTime(1_501))
  expect(result.current.session).toBeNull()
  await act(async () => caches[0]!.resolve())
  expect(result.current.session?.hasCachedContent).toBe(false)
  expect(result.current.session?.doc.getXmlFragment('default').length).toBe(0)
})
