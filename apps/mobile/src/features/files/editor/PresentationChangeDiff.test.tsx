// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostMessage } from './protocol'

const mocks = vi.hoisted(() => ({
  post: vi.fn(async (_message: string) => undefined),
  receive: undefined as undefined | ((event: { nativeEvent: { data: string } }) => void),
  terminate: undefined as undefined | (() => void),
  theme: { blue: '#00f', secondary: '#666' },
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'diff-instance' }))
vi.mock('../../../theme', () => ({ useAppTheme: () => mocks.theme }))
vi.mock('../../../api/client', () => ({ apiUrl: (path: string) => path, nativeAuthorizationHeaders: () => ({}) }))
vi.mock('../api', () => ({}))
vi.mock('../cache', () => ({}))
vi.mock('./presentation', () => ({ editorTheme: () => ({ background: '#fff' }) }))
vi.mock('./presentationEditorBundle.generated', () => ({ PRESENTATION_EDITOR_BUNDLE: { html: '' } }))
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
  ActivityIndicator: () => null,
  StyleSheet: { create: (value: unknown) => value },
}))
vi.mock('./DocEditorView', async () => {
  const { useImperativeHandle } = await import('react')
  return { NativeDocEditor: ({ ref, onMessage, onTerminate }: { ref: Ref<unknown>; onMessage: typeof mocks.receive; onTerminate: typeof mocks.terminate }) => {
    useImperativeHandle(ref, () => ({ postMessage: mocks.post }))
    mocks.receive = onMessage
    mocks.terminate = onTerminate
    return null
  } }
})

const { PresentationChangeDiff } = await import('./PresentationChangeDiff')
const { filesQueryKeys } = await import('../queries')
let client: QueryClient
let host: HTMLDivElement
let root: Root
const failed = vi.fn()
const fetchMock = vi.fn<typeof fetch>()
const response = (text: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(text).buffer }) as Response
const messages = () => mocks.post.mock.calls.map(([text]) => JSON.parse(text) as Extract<HostMessage, { type: 'presentationDiff' }>)
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
const ready = () => act(() => mocks.receive!({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } }))
const render = () => act(() => root.render(<QueryClientProvider client={client}><PresentationChangeDiff changeId="change" namespace="ns" responseId="reply" onFailed={failed} /></QueryClientProvider>))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async (url) => response(String(url).endsWith('/before') ? 'before' : 'first'))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  client.clear()
  host.remove()
  vi.unstubAllGlobals()
})

describe('presentation proposal review', () => {
  it('sends after readiness, refetches a revised proposal with the same id, and resends after a page reload', async () => {
    render()
    await settle()
    expect(mocks.post).not.toHaveBeenCalled()
    ready()
    await settle()
    expect(messages().map((message) => message.after)).toEqual(['Zmlyc3Q='])
    fetchMock.mockImplementation(async (url) => response(String(url).endsWith('/before') ? 'before' : 'revised'))
    await act(async () => { await client.invalidateQueries({ queryKey: filesQueryKeys.responseChanges('ns', 'reply') }) })
    await settle()
    expect(messages().map((message) => message.after)).toEqual(['Zmlyc3Q=', 'cmV2aXNlZA=='])
    act(() => mocks.terminate!())
    ready()
    await settle()
    expect(messages().at(-1)!.after).toBe('cmV2aXNlZA==')
    expect(messages()).toHaveLength(3)
    expect(failed).not.toHaveBeenCalled()
  })

  it('waits for data after ready and ignores a superseded refetch that finishes last', async () => {
    render()
    ready()
    await settle()
    expect(messages()).toHaveLength(1)
    let finish!: (value: Response) => void
    let staleSignal: AbortSignal | null | undefined
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/before')) return response('before')
      staleSignal = init?.signal
      return new Promise<Response>((resolve) => { finish = resolve })
    })
    let oldRefresh!: Promise<void>
    act(() => { oldRefresh = client.invalidateQueries({ queryKey: filesQueryKeys.responseChanges('ns', 'reply') }) })
    await settle()
    fetchMock.mockImplementation(async (url) => response(String(url).endsWith('/before') ? 'before' : 'latest'))
    await act(async () => { await client.invalidateQueries({ queryKey: filesQueryKeys.responseChanges('ns', 'reply') }) })
    await settle()
    expect(staleSignal?.aborted).toBe(true)
    await act(async () => { finish(response('stale')); await oldRefresh })
    await settle()
    expect(messages().map((message) => message.after)).toEqual(['Zmlyc3Q=', 'bGF0ZXN0'])
  })

  it('falls back after a failed revision without sending the cached proposal again', async () => {
    render()
    ready()
    await settle()
    expect(messages()).toHaveLength(1)
    fetchMock.mockResolvedValue({ ok: false } as Response)
    await act(async () => { await client.invalidateQueries({ queryKey: filesQueryKeys.responseChanges('ns', 'reply') }) })
    await settle()
    expect(failed).toHaveBeenCalledOnce()
    expect(messages()).toHaveLength(1)
  })

  it.each(['fetch failure', 'over 40 MiB'])('falls back on %s', async (reason) => {
    fetchMock.mockResolvedValue(reason === 'fetch failure'
      ? { ok: false } as Response
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(21 * 1024 * 1024) } as Response)
    render()
    await settle()
    expect(failed).toHaveBeenCalledOnce()
    expect(mocks.post).not.toHaveBeenCalled()
  })
})
