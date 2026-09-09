// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Profiler } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComposerSync } from '@pulpo/client-core'
import { emptyComposerState, type ComposerSnapshot, type ComposerWrite } from '@pulpo/contracts'
import type { Model } from '@/lib/types'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
const fixture = vi.hoisted(() => ({ sync: null as ComposerSync | null }))
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => fixture.sync, clearWebComposerSync() {} }))
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
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft, runtimeComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { useComposerSyncPreference } = await import('@/stores/composer-sync-preference')

const userId = '00000000-0000-4000-8000-000000000001'
const defaults = { reasoning: 'medium', speed: 'auto' }
const selected = { reasoning: 'low', speed: 'fast' }
const model: Model = {
  id: 'test-model', name: 'Test Model', providerGroupId: 'test', provider: 'Test', inferenceProvider: 'Test',
  labLogo: 'pulpo', modelLogo: 'pulpo', description: '', contextWindow: 128_000, tags: [],
  iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0, perMessagePrice: 0,
  enabled: true, agentEnabled: true,
  presets: [
    { id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'medium', choices: [
      { id: 'medium', displayName: 'Medium', action: { type: 'none' } },
      { id: 'low', displayName: 'Low', action: { type: 'none' } },
    ] },
    { id: 'speed', name: 'Speed', icon: 'rocket', defaultChoiceId: 'auto', choices: [
      { id: 'auto', displayName: 'Auto', action: { type: 'none' } },
      { id: 'fast', displayName: 'Fast', action: { type: 'none' } },
    ] },
  ],
}
const requests: { path: string; body: Record<string, unknown> }[] = []
const renderedControls: string[] = []
const snapshots = new Map<string, ComposerSnapshot>()
const write = vi.fn(async (input: ComposerWrite) => {
  const prior = snapshots.get(input.draftId)!
  const revision = prior.revision + 1
  const snapshot = { ...prior, revision, mutationId: input.mutationId,
    clearedRevision: input.clear ? revision : prior.clearedRevision,
    state: input.clear ? { ...prior.state, content: '', attachments: [] } : { ...prior.state, ...input.patch } }
  snapshots.set(input.draftId, snapshot)
  return { ok: true as const, snapshot }
})

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    if (path.endsWith('/api/interface/suggested-prompts')) return new Response(JSON.stringify({
      enabled: true, count: 1, prompts: [{ id: 'suggestion', label: 'Try a suggestion', message: 'suggested message' }],
    }))
    requests.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await localDb.drafts.clear()
  clearRuntimeComposerDrafts(userId)
  queryClient.clear()
  requests.length = 0
  renderedControls.length = 0
  snapshots.clear()
  write.mockClear()
  fixture.sync = null
  useAuth.setState({ user: { id: userId } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, dictationEnabled: false })
  useSettings.setState({ generation: { [model.id]: defaults }, agentModes: { [model.id]: true },
    defaultModelId: model.id, showPromptSuggestions: true, sendWithEnter: true })
  useComposerSyncPreference.setState({ enabled: true, generation: '' })
  useCatalog.setState({ models: [model], loaded: true, agentAvailable: true })
  useChat.setState({ chats: [], folders: [], activeChatId: null, activeTemporaryChatId: null,
    streamingIds: [], responseSequences: {}, responseChatIds: {}, adminAccessRequiredChatId: null })
  useUploadOutbox.setState({ uploads: {}, submissions: [], preservedDrafts: {} })
})
afterEach(() => { cleanup(); fixture.sync?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function enableSync() {
  fixture.sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'test')
  fixture.sync.connect({ read: async (draftId) => {
    const snapshot = snapshots.get(draftId) ?? { draftId, revision: 0, clearedRevision: 0, mutationId: null, state: emptyComposerState() }
    snapshots.set(draftId, snapshot)
    return { ok: true, snapshot }
  }, write })
}
function renderChat(path = '/') {
  return render(<Profiler id="chat" onRender={() => {
    const label = document.querySelector('button[aria-label="Generation options"]')?.textContent
    if (label) renderedControls.push(label)
  }}><MemoryRouter initialEntries={[path]}><TooltipProvider><Routes>
    <Route path="/" element={<ChatPage />} />
    <Route path="/c/:chatId" element={<ChatPage />} />
  </Routes></TooltipProvider></MemoryRouter></Profiler>)
}
async function selectControls(view: ReturnType<typeof renderChat>) {
  for (const choice of ['Low', 'Fast']) {
    fireEvent.keyDown(view.getByRole('button', { name: 'Generation options' }), { key: 'ArrowDown' })
    fireEvent.click(await view.findByRole('menuitem', { name: choice }))
  }
  fireEvent.click(view.getByRole('button', { name: /disable agent/i }))
  await waitFor(() => expect(view.getByRole('button', { name: 'Generation options' }).textContent).toContain('Low'))
}
function expectControls(view: ReturnType<typeof renderChat>) {
  const label = view.getByRole('button', { name: 'Generation options' }).textContent
  expect(label).toContain('Low')
  expect(label).toContain('Fast')
  expect(view.getByRole('button', { name: /enable agent/i }).getAttribute('aria-pressed')).toBe('false')
  expect(useSettings.getState().generation[model.id]).toEqual(defaults)
  expect(useSettings.getState().agentModes[model.id]).toBe(true)
}

function expectNoPresetFlash() {
  expect(renderedControls.filter((label) => !label.includes('Low') || !label.includes('Fast'))).toEqual([])
}

it.each([
  { syncEnabled: false, temporary: false },
  { syncEnabled: true, temporary: false },
  { syncEnabled: false, temporary: true },
])('keeps controls on Enter, the started composer, and a follow-up ($syncEnabled, $temporary)', async ({ syncEnabled, temporary }) => {
  if (syncEnabled) enableSync()
  const view = renderChat()
  await view.findByRole('button', { name: 'Try a suggestion' })
  if (temporary) {
    fireEvent.click(view.getByRole('button', { name: /enable temporary/i }))
    await view.findByRole('button', { name: /disable temporary/i })
  }
  await selectControls(view)
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'hello' } })
  renderedControls.length = 0
  const landingInput = view.getByRole('textbox')
  fireEvent.keyDown(landingInput, { key: 'Enter' })
  await waitFor(() => expect(requests.some((request) => request.path.endsWith('/api/chats/start'))).toBe(true))
  await waitFor(() => expect(view.getByRole('textbox')).not.toBe(landingInput))
  const start = requests.find((request) => request.path.endsWith('/api/chats/start'))!
  expect(start.body.response).toMatchObject({ input: 'hello', presetSelections: selected, agentMode: false })
  expectControls(view)
  expectNoPresetFlash()
  const chatId = useChat.getState().activeChatId!
  await waitFor(() => expect(useChat.getState().chats.find((chat) => chat.id === chatId)?.provisional).toBe(false))
  if (syncEnabled) await waitFor(() => expect(snapshots.get(chatId)?.state.model?.presets).toEqual(selected))
  // Finish the optimistic turn so the next Enter creates a regular response.
  act(() => useChat.setState((state) => ({ streamingIds: [], chats: state.chats.map((chat) => ({
    ...chat, messages: chat.messages.map((message) => ({ ...message, done: true })),
  })) })))
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'follow-up' } })
  fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' })
  await waitFor(() => expect(requests.some((request) => request.path.endsWith(`/api/chats/${chatId}/responses`))).toBe(true))
  expect(requests.find((request) => request.path.endsWith(`/api/chats/${chatId}/responses`))!.body)
    .toMatchObject({ input: 'follow-up', presetSelections: selected, agentMode: false })
  if (!syncEnabled && !temporary) {
    fireEvent.click(view.getByRole('button', { name: 'New chat' }))
    await view.findByRole('button', { name: 'Try a suggestion' })
    expect(view.getByRole('button', { name: 'Generation options' }).textContent).toContain('Medium')
    expect(view.getByRole('button', { name: 'Generation options' }).textContent).toContain('Auto')
  }
})

it.each([false, true])('uses selected controls for suggestions and preserves the unsent draft (temporary: %s)', async (temporary) => {
  if (!temporary) enableSync()
  seedPendingUpload('keep this draft')
  const view = renderChat()
  await view.findByRole('button', { name: 'Try a suggestion' })
  if (temporary) fireEvent.click(view.getByRole('button', { name: /enable temporary/i }))
  if (temporary) await view.findByRole('button', { name: /disable temporary/i })
  await selectControls(view)
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'keep this draft' } })
  renderedControls.length = 0
  const landingInput = view.getByRole('textbox')
  fireEvent.click(view.getByRole('button', { name: 'Try a suggestion' }))
  await waitFor(() => expect(requests.some((request) => request.path.endsWith('/api/chats/start'))).toBe(true))
  await waitFor(() => expect(view.getByRole('textbox')).not.toBe(landingInput))
  const start = requests.find((request) => request.path.endsWith('/api/chats/start'))!
  expect(start.body.response).toMatchObject({ input: 'suggested message', presetSelections: selected, agentMode: false, attachmentIds: [] })
  expect(start.body.chat).toMatchObject({ temporary })
  expectControls(view)
  expectNoPresetFlash()
  expect(runtimeComposerDraft(userId, temporary ? 'temporary:new' : 'new')?.content).toBe('keep this draft')
  expect(runtimeComposerDraft(userId, temporary ? 'temporary:new' : 'new')?.attachmentIds).toEqual(['pending'])
  expect(write.mock.calls.some(([input]) => input.clear)).toBe(false)
})

function seedPendingUpload(content: string) {
  const pending = { localId: 'pending', name: 'image.png', size: 1, mimeType: 'image/png', status: 'uploading' as const }
  useUploadOutbox.setState({ uploads: { pending: { ...pending, chatId: null, temporary: false, previewUrl: null, managed: true, attempt: 0 } } })
  rememberRuntimeComposerDraft(userId, 'new', { content, attachments: [pending], attachmentIds: ['pending'] })
}

it('seeds the started composer before a pending upload is dispatched', async () => {
  seedPendingUpload('hello')
  const view = renderChat()
  await view.findByRole('button', { name: 'Try a suggestion' })
  await selectControls(view)
  renderedControls.length = 0
  const landingInput = view.getByRole('textbox')
  fireEvent.keyDown(landingInput, { key: 'Enter' })
  await waitFor(() => expect(view.getByRole('textbox')).not.toBe(landingInput))
  expect(useUploadOutbox.getState().submissions[0]?.presetSelections).toEqual(selected)
  expectControls(view)
  expectNoPresetFlash()
  expect(requests.some((request) => request.path.endsWith('/api/chats/start'))).toBe(false)
})

it('gives an existing synced draft priority over the last submitted controls', async () => {
  const chatId = useChat.getState().sendMessage(null, 'previous turn', model.id, [], false, false, {
    targetChatId: crypto.randomUUID(), responseId: crypto.randomUUID(), presetSelections: selected, agentMode: false,
  })
  snapshots.set(chatId, { draftId: chatId, revision: 4, clearedRevision: 0, mutationId: null,
    state: { ...emptyComposerState(), content: 'newer shared draft', model: { id: model.id, presets: defaults }, agentMode: true } })
  enableSync()
  const view = renderChat(`/c/${chatId}`)
  await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('newer shared draft'))
  const label = view.getByRole('button', { name: 'Generation options' }).textContent
  expect(label).toContain('Medium')
  expect(label).toContain('Auto')
  expect(view.getByRole('button', { name: /disable agent/i }).getAttribute('aria-pressed')).toBe('true')
  expect(snapshots.get(chatId)?.state.model?.presets).toEqual(defaults)
})

it.each(['send', 'suggestion'])('does not flash defaults when older summaries finish after chat creation (%s)', async (action) => {
  const view = renderChat()
  await view.findByRole('button', { name: 'Try a suggestion' })
  await selectControls(view)
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'hello' } })
  const landingInput = view.getByRole('textbox')
  fireEvent.click(view.getByRole('button', { name: action === 'send' ? 'Send message' : 'Try a suggestion' }))
  await waitFor(() => expect(view.getByRole('textbox')).not.toBe(landingInput))
  const chatId = useChat.getState().activeChatId!
  await waitFor(() => expect(useChat.getState().chats.find((chat) => chat.id === chatId)?.provisional).toBe(false))
  const detail = queryClient.getQueryData<import('@/stores/chat').ServerChat>(['chat', userId, chatId])!
  const startedInput = view.getByRole('textbox')
  fireEvent.change(startedInput, { target: { value: 'next unsent message' } })
  renderedControls.length = 0
  // The request started before POST /chats/start, so it cannot contain this chat.
  act(() => useChat.getState().replaceSummaries([]))
  // The chat detail refresh arrives afterward and brings the selected turn back.
  act(() => useChat.getState().setDetailedChat(detail))
  expect(view.getByRole('textbox')).toBe(startedInput)
  expect((startedInput as HTMLTextAreaElement).value).toBe('next unsent message')
  expectNoPresetFlash()
})
