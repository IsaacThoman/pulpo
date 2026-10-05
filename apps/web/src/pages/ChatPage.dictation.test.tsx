// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Model } from '@/lib/types'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: query === '(pointer: fine)', addEventListener() {}, removeEventListener() {} }) })
})
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => null, clearWebComposerSync() {} }))
vi.mock('@/components/chat/MessageList', () => ({ MessageList: () => null }))
vi.mock('@/lib/local-first/shelf', () => ({ webShelf: () => null }))
const { ChatPage } = await import('./ChatPage')
const { useChat } = await import('@/stores/chat')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { useCatalog } = await import('@/stores/catalog')
const { queryClient } = await import('@/lib/query-client')
const { localDb } = await import('@/lib/local-first/database')
const { clearRuntimeComposerDrafts } = await import('@/lib/local-first/composer-drafts')
const { useComposerSyncPreference } = await import('@/stores/composer-sync-preference')

const userId = '00000000-0000-4000-8000-000000000001'
const model: Model = {
  id: 'test-model', name: 'Test Model', providerGroupId: 'test', provider: 'Test', inferenceProvider: 'Test',
  labLogo: 'pulpo', modelLogo: 'pulpo', description: '', contextWindow: 128_000, tags: [],
  iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0, perMessagePrice: 0,
  enabled: true, agentEnabled: true,
  presets: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'medium', choices: [
    { id: 'medium', displayName: 'Medium', action: { type: 'none' } },
    { id: 'high', displayName: 'High', action: { type: 'none' } },
  ] }],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const media = {
  recorders: [] as FakeMediaRecorder[],
  tracks: [] as Array<{ stop: ReturnType<typeof vi.fn> }>,
  contexts: 0,
  getUserMedia: vi.fn(),
  transcriptions: [] as Array<{ body: FormData; signal: AbortSignal | null | undefined }>,
  transcript: null as ReturnType<typeof deferred<string>> | null,
}
const requests: Array<{ path: string; body: Record<string, unknown> }> = []
function microphone() {
  const track = { stop: vi.fn() }
  media.tracks.push(track)
  return { getTracks: () => [track] } as unknown as MediaStream
}
class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  state: RecordingState = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly stream: MediaStream
  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream
    this.mimeType = options?.mimeType ?? 'audio/webm'
    media.recorders.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    // Browsers flush the final chunk and fire stop asynchronously.
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) })
      this.onstop?.()
    }, 0)
  }
}
class FakeAudioContext {
  state = 'running'
  constructor() { media.contexts += 1 }
  createMediaStreamSource() { return { connect() {}, disconnect() {} } }
  createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.2) } }
  async resume() {}
  async close() {}
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Element.prototype.scrollIntoView = vi.fn()
  media.recorders.length = 0
  media.tracks.length = 0
  media.contexts = 0
  media.transcriptions.length = 0
  media.transcript = null
  requests.length = 0
  media.getUserMedia.mockReset().mockImplementation(async () => microphone())
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: media.getUserMedia } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).endsWith('/api/dictation/transcriptions')) {
      if (typeof init?.body === 'string') requests.push({ path: String(input), body: JSON.parse(init.body) })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    media.transcriptions.push({ body: init!.body as FormData, signal: init!.signal })
    const pending = media.transcript ?? deferred<string>()
    if (!media.transcript) pending.resolve('hello from dictation')
    const abort = new Promise<never>((_, reject) => init!.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    const text = await Promise.race([pending.promise, abort])
    return new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await localDb.drafts.clear()
  clearRuntimeComposerDrafts(userId)
  queryClient.clear()
  useAuth.setState({ user: { id: userId } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, dictationEnabled: true })
  useSettings.setState({ generation: {}, agentModes: { [model.id]: false }, defaultModelId: model.id,
    showPromptSuggestions: false, sendWithEnter: true, composerSyncEnabled: false })
  useComposerSyncPreference.setState({ enabled: false, generation: '' })
  useCatalog.setState({ models: [model], loaded: true, agentAvailable: true })
  useChat.setState({ chats: [], folders: [], activeChatId: null, activeTemporaryChatId: null,
    streamingIds: [], responseSequences: {}, responseChatIds: {}, adminAccessRequiredChatId: null })
  useUploadOutbox.setState({ uploads: {}, submissions: [], preservedDrafts: {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function renderComposer() {
  const view = render(<MemoryRouter initialEntries={['/']}><TooltipProvider><Routes>
    <Route path="/" element={<ChatPage />} />
    <Route path="/c/:chatId" element={<ChatPage />} />
  </Routes></TooltipProvider></MemoryRouter>)
  const textarea = await waitFor(() => {
    const element = view.container.querySelector('textarea')
    if (!element) throw new Error('composer not ready')
    return element
  })
  const face = (name: 'draft' | 'dictation') => view.container.querySelector<HTMLElement>(`.composer-toolbar-face[data-face="${name}"]`)!
  const dictating = () => face('dictation').dataset.active === 'true'
  const recording = () => waitFor(() => expect(view.getByRole('status', { name: /^Recording / })).toBeTruthy())
  const toolbarRestored = () => waitFor(() => {
    expect(face('draft').dataset.active).toBe('true')
    expect(face('dictation').dataset.active).toBe('false')
  })
  return { ...view, textarea, face, dictating, recording, toolbarRestored }
}

it('swaps the toolbar for a live waveform and inserts the transcript when finished', async () => {
  const view = await renderComposer()
  fireEvent.change(view.textarea, { target: { value: 'Note:' } })
  expect(view.face('dictation').hasAttribute('inert')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  expect(view.dictating()).toBe(true)
  expect(view.face('draft').hasAttribute('inert')).toBe(true)
  expect(view.face('dictation').hasAttribute('inert')).toBe(false)
  await view.recording()
  expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true })
  expect(media.recorders[0]!.mimeType).toBe('audio/webm;codecs=opus')
  expect(media.contexts).toBe(1)
  expect(view.getByTestId('dictation-waveform')).toBeTruthy()
  expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)

  fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
  await waitFor(() => expect(view.textarea.value).toBe('Note: hello from dictation'))
  const file = media.transcriptions[0]!.body.get('file') as File
  expect(file.name).toBe('dictation.webm')
  expect(media.tracks[0]!.stop).toHaveBeenCalled()
  await view.toolbarRestored()
  expect(view.face('draft').hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(view.textarea)
})

it('keeps attachments, presets, and agent controls usable while recording', async () => {
  const view = await renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await view.recording()
  const leftControls = [
    view.getByRole('button', { name: /^(Add files or folders|Attach files)$/ }),
    view.getByRole('button', { name: 'Generation options' }),
    view.getByRole('button', { name: /^Agent options/ }),
  ]
  for (const control of leftControls) {
    expect(control.closest('[inert]')).toBeNull()
    expect(control.closest('.composer-toolbar-face')).toBeNull()
    expect(control.hasAttribute('disabled')).toBe(false)
  }
  // Only the trailing actions are swapped for the dictation bar.
  expect(view.getByRole('button', { name: 'Dictate' }).closest('[inert]')).toBe(view.face('draft'))
  expect(view.getByRole('button', { name: 'Send message' }).closest('[inert]')).toBe(view.face('draft'))
  fireEvent.keyDown(view.getByRole('button', { name: 'Generation options' }), { key: 'ArrowDown' })
  fireEvent.click(await view.findByRole('menuitem', { name: 'High' }))
  await waitFor(() => expect(view.getByRole('button', { name: 'Generation options' }).textContent).toContain('High'))
  expect(view.dictating()).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
  await waitFor(() => expect(view.textarea.value).toBe('hello from dictation'))
})

it('cancels a recording without uploading it', async () => {
  const view = await renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await view.recording()
  fireEvent.click(view.getByRole('button', { name: 'Cancel dictation' }))
  await view.toolbarRestored()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(media.transcriptions).toHaveLength(0)
  expect(media.tracks[0]!.stop).toHaveBeenCalled()
  expect(media.recorders[0]!.state).toBe('inactive')
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.textarea.value).toBe('')
})

it('finishes with the send shortcut and cancels with Escape from the composer', async () => {
  const view = await renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await view.recording()
  expect(document.activeElement).toBe(view.textarea)
  fireEvent.keyDown(view.textarea, { key: 'Escape' })
  await view.toolbarRestored()
  expect(media.transcriptions).toHaveLength(0)

  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await view.recording()
  fireEvent.keyDown(view.textarea, { key: 'Enter' })
  await waitFor(() => expect(view.textarea.value).toBe('hello from dictation'))
  expect(media.transcriptions).toHaveLength(1)
})

it('cancels while waiting for microphone permission and releases a late grant', async () => {
  const permission = deferred<MediaStream>()
  media.getUserMedia.mockReturnValueOnce(permission.promise)
  const view = await renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  expect(view.getByRole('status', { name: 'Waiting for microphone…' })).toBeTruthy()
  expect(view.getByRole('button', { name: 'Finish dictation' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Cancel dictation' }))
  await view.toolbarRestored()
  await act(async () => permission.resolve(microphone()))
  expect(media.tracks[0]!.stop).toHaveBeenCalledOnce()
  expect(media.recorders).toHaveLength(0)
  expect(view.dictating()).toBe(false)
})

it('aborts an in-flight transcription and ignores its late result', async () => {
  media.transcript = deferred<string>()
  const view = await renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await view.recording()
  fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
  await waitFor(() => expect(view.getByRole('status', { name: 'Transcribing…' })).toBeTruthy())
  expect(view.getByRole('button', { name: 'Finish dictation' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Cancel dictation' }))
  await view.toolbarRestored()
  expect(media.transcriptions[0]!.signal?.aborted).toBe(true)
  await act(async () => media.transcript!.resolve('too late'))
  expect(view.textarea.value).toBe('')
  expect(view.queryByRole('alert')).toBeNull()

  // A new recording after cancelling is unaffected by the abandoned one.
  media.transcript = null
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await view.recording()
  fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
  await waitFor(() => expect(view.textarea.value).toBe('hello from dictation'))
})

it('reports denied microphone permission and restores the toolbar', async () => {
  media.getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
  const view = await renderComposer()
  fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe('Microphone permission was denied'))
  await view.toolbarRestored()
  expect(media.recorders).toHaveLength(0)
})

it('flags dictated messages when sending and resets the flag for the next draft', async () => {
  const view = await renderComposer()
  const textbox = () => view.getByRole('textbox') as HTMLTextAreaElement
  const dictate = async () => {
    const transcriptions = media.transcriptions.length
    fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
    await view.recording()
    fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
    await waitFor(() => expect(media.transcriptions).toHaveLength(transcriptions + 1))
    await waitFor(() => expect(textbox().value).toBe('hello from dictation'))
    await view.toolbarRestored()
  }
  const sent = (suffix: string) => requests.filter((request) => request.path.endsWith(suffix))

  await dictate()
  const landing = textbox()
  fireEvent.keyDown(landing, { key: 'Enter' })
  await waitFor(() => expect(sent('/api/chats/start')).toHaveLength(1))
  // The started chat gets its own composer.
  await waitFor(() => expect(textbox()).not.toBe(landing))
  expect(sent('/api/chats/start')[0]!.body.response).toMatchObject({ input: 'hello from dictation', usedDictation: true })
  const chatId = useChat.getState().activeChatId!
  await waitFor(() => expect(useChat.getState().chats.find((chat) => chat.id === chatId)?.provisional).toBe(false))

  // The first response is still streaming, so this one is queued.
  fireEvent.change(textbox(), { target: { value: '' } })
  await dictate()
  fireEvent.keyDown(textbox(), { key: 'Enter' })
  await waitFor(() => expect(sent(`/api/chats/${chatId}/queued-messages`)).toHaveLength(1))
  expect(sent(`/api/chats/${chatId}/queued-messages`)[0]!.body).toMatchObject({ input: 'hello from dictation', usedDictation: true })

  act(() => useChat.setState((state) => ({ streamingIds: [], chats: state.chats.map((chat) => ({
    ...chat, queuedMessages: [], messages: chat.messages.map((message) => ({ ...message, done: true })),
  })) })))
  await waitFor(() => expect(textbox().value).toBe(''))
  fireEvent.change(textbox(), { target: { value: 'typed follow-up' } })
  fireEvent.keyDown(textbox(), { key: 'Enter' })
  await waitFor(() => expect(sent(`/api/chats/${chatId}/responses`)).toHaveLength(1))
  const followUp = sent(`/api/chats/${chatId}/responses`)[0]!.body
  expect(followUp).toMatchObject({ input: 'typed follow-up' })
  expect(followUp).not.toHaveProperty('usedDictation')
})
