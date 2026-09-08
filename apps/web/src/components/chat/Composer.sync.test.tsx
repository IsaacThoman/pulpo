// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createRef, useState } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyComposerState, type ComposerSnapshot, type ComposerWrite } from '@pulpo/contracts'
import { ComposerSync } from '@pulpo/client-core'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
vi.mock('./WorkspacePicker', () => ({ WorkspacePicker: () => null }))
const fixture = vi.hoisted(() => ({ sync: null as ComposerSync | null, rows: new Map<string, unknown>() }))
vi.mock('@/lib/local-first/composer-sync', () => ({ webComposerSync: () => fixture.sync, clearWebComposerSync() {} }))
vi.mock('@/lib/local-first/database', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, localAccountKey: (id: string) => id, localDb: {
    drafts: {
      where: () => ({ equals: ([userId, chatId]: string[]) => ({
        first: async () => fixture.rows.get(`${userId}:${chatId}`),
        delete: async () => { fixture.rows.delete(`${userId}:${chatId}`) },
      }) }),
      put: async (row: { userId: string; chatId: string }) => { fixture.rows.set(`${row.userId}:${row.chatId}`, row) },
    },
  } }
})
const { Composer } = await import('./Composer')
const { useUploadOutbox } = await import('@/stores/upload-outbox')
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { clearRuntimeComposerDrafts, rememberRuntimeComposerDraft, runtimeComposerDraft, saveComposerDraft } = await import('@/lib/local-first/composer-drafts')
const { useComposerSyncPreference } = await import('@/stores/composer-sync-preference')

beforeEach(() => {
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
  useSettings.setState({ composerSyncEnabled: true, agentModes: { model: false } })
  useComposerSyncPreference.setState({ enabled: true, generation: '' })
  useUploadOutbox.setState({ uploads: {}, submissions: [] })
  fixture.rows.clear()
  clearRuntimeComposerDrafts('account')
})
afterEach(() => { cleanup(); fixture.sync?.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })

it.each([false, true])('does not reload a persisted sent draft after a remote clear (runtime cache: %s)', async (runtimeCached) => {
  const draftId = '11111111-1111-4111-8111-111111111111'
  const state = { ...emptyComposerState(), content: 'sent from mobile', model: { id: 'model', presets: {} } }
  let snapshot: ComposerSnapshot = { draftId, state, revision: 1, clearedRevision: 0, mutationId: null }
  const write = vi.fn(async (input: ComposerWrite) => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, mutationId: input.mutationId,
      state: { ...snapshot.state, ...input.patch } }
    return { ok: true as const, snapshot }
  })
  fixture.sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'web')
  fixture.sync.connect({ read: async () => ({ ok: true, snapshot }), write })
  await saveComposerDraft('account', draftId, { content: state.content, attachments: [] })
  if (runtimeCached) rememberRuntimeComposerDraft('account', draftId, { content: state.content, attachments: [], attachmentIds: [] })
  const composer = (centered = false) => <MemoryRouter><TooltipProvider><Composer chatId={draftId} modelId="model" centered={centered} /></TooltipProvider></MemoryRouter>
  const view = render(composer())
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(input.value).toBe(state.content))
  await act(async () => { await fixture.sync!.flush(draftId) })
  write.mockClear()
  vi.useFakeTimers()
  snapshot = { ...snapshot, revision: 2, clearedRevision: 2, state: { ...state, content: '' } }
  await act(async () => fixture.sync!.receive(snapshot))
  expect(input.value).toBe('')
  // Queue/transcript/store updates can render again before the 150ms disk save.
  await act(async () => view.rerender(composer(true)))
  await act(async () => { await vi.advanceTimersByTimeAsync(150) })
  expect(input.value).toBe('')
  expect(write).not.toHaveBeenCalled()
})


it('keeps temporary drafts in a separate local slot when switching back to normal mode', async () => {
  const state = { ...emptyComposerState(), content: 'normal shared draft', model: { id: 'model', presets: {} } }
  const snapshot: ComposerSnapshot = { draftId: 'new', state, revision: 1, clearedRevision: 0, mutationId: null }
  const read = vi.fn(async () => ({ ok: true as const, snapshot }))
  const write = vi.fn(async () => ({ ok: true as const, snapshot }))
  fixture.sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'web')
  fixture.sync.connect({ read, write })
  const composer = (temporary: boolean) => <MemoryRouter><TooltipProvider>
    <Composer chatId={null} modelId="model" temporary={temporary} />
  </TooltipProvider></MemoryRouter>
  const view = render(composer(true))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'private local draft' } })
  await waitFor(() => expect(runtimeComposerDraft('account', 'temporary:new')).toMatchObject({ content: 'private local draft' }))
  expect(fixture.rows.has('account:temporary:new')).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  view.rerender(composer(false))
  await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('normal shared draft'))
  expect(write).not.toHaveBeenCalled()
  view.rerender(composer(true))
  await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('private local draft'))
})


it.each([true, false])('moves the actual composer and upload ownership through the toggle (sync: %s)', async (syncEnabled) => {
  const initial = { ...emptyComposerState(), content: 'draft to carry', model: { id: 'model', presets: {} }, autoExpire: true }
  let snapshot: ComposerSnapshot = { draftId: 'new', state: initial, revision: 1, clearedRevision: 0, mutationId: null }
  const observer = vi.fn()
  const peer = new ComposerSync({ load: async () => null, save: async () => {} }, 'peer')
  const write = vi.fn(async (input: ComposerWrite) => {
    if (input.baseRevision !== snapshot.revision) return { ok: true as const, snapshot, conflict: true }
    const revision = snapshot.revision + 1
    snapshot = { ...snapshot, revision, mutationId: input.mutationId, clearedRevision: input.clear ? revision : snapshot.clearedRevision,
      state: input.clear ? { ...snapshot.state, content: '', attachments: [] } : { ...snapshot.state, ...input.patch } }
    peer.receive(snapshot)
    return { ok: true as const, snapshot }
  })
  fixture.sync = new ComposerSync({ load: async () => null, save: async () => {} }, 'web')
  const transport = { read: async () => ({ ok: true as const, snapshot }), write }
  fixture.sync.connect(transport); peer.connect(transport)
  await peer.open('new', initial, observer)
  const pending = { localId: 'pending', name: 'pending.txt', size: 1, mimeType: 'text/plain', status: 'uploading' as const }
  const failed = { ...pending, localId: 'failed', name: 'failed.txt', status: 'error' as const, error: 'Upload failed' }
  for (const item of [pending, failed]) useUploadOutbox.setState((state) => ({ uploads: { ...state.uploads,
    [item.localId]: { ...item, chatId: null, temporary: false, previewUrl: null, managed: true, attempt: 0 },
  } }))
  rememberRuntimeComposerDraft('account', 'new', { content: initial.content, attachmentIds: ['pending', 'failed'], attachments: [pending, failed] })
  const control = createRef<{ toggle: () => Promise<void> }>()
  function Draft() {
    const [temporary, setTemporary] = useState(false)
    return <MemoryRouter><TooltipProvider><Composer chatId={null} modelId="model" autoExpire temporary={temporary}
      temporaryControlRef={control} onTemporaryChange={setTemporary} syncEnabled={syncEnabled} /></TooltipProvider></MemoryRouter>
  }
  const view = render(<Draft />)
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(input.value).toBe(initial.content)
  fireEvent.change(input, { target: { value: 'latest keystroke' } })
  await act(async () => { await control.current!.toggle() })
  expect(input.value).toBe('latest keystroke')
  expect(useUploadOutbox.getState().uploads.pending?.temporary).toBe(true)
  expect(useUploadOutbox.getState().uploads.failed?.temporary).toBe(true)
  expect(fixture.rows.has('account:new')).toBe(false)
  expect(fixture.rows.has('account:temporary:new')).toBe(false)
  expect(runtimeComposerDraft('account', 'new')).toBeNull()
  if (syncEnabled) await waitFor(() => expect(observer.mock.lastCall?.[0].snapshot.state.content).toBe(''))
  fireEvent.change(input, { target: { value: 'temporary edit' } })
  await act(async () => useUploadOutbox.setState((state) => ({ uploads: { ...state.uploads,
    pending: { ...state.uploads.pending!, status: 'ready', id: '11111111-1111-4111-8111-111111111111' },
  } })))
  expect(snapshot.state.content).toBe(syncEnabled ? '' : initial.content)
  await act(async () => { await control.current!.toggle() })
  expect(input.value).toBe('temporary edit')
  expect(useUploadOutbox.getState().uploads.pending?.temporary).toBe(false)
  expect(useUploadOutbox.getState().uploads.failed?.temporary).toBe(false)
  expect(runtimeComposerDraft('account', 'temporary:new')).toBeNull()
  if (syncEnabled) {
    await waitFor(() => expect(snapshot.state.content).toBe('temporary edit'))
    expect(snapshot.state.attachments.map((a) => a.id)).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(snapshot.state.autoExpire).toBe(true)
  } else expect(write).not.toHaveBeenCalled()
  peer.dispose()
})


it('follows a remote start with focus and preserves remaining text and uploads in the new draft', async () => {
  const { webChatStarted } = await import('@/lib/chat-started')
  fixture.sync = null
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const chatId = '22222222-2222-4222-8222-222222222222'
  const pending = { localId: 'remaining-upload', name: 'remaining.txt', size: 1, mimeType: 'text/plain', status: 'uploading' as const }
  useUploadOutbox.setState({ uploads: {
    [pending.localId]: { ...pending, chatId: null, temporary: false, previewUrl: null, managed: true, attempt: 0 },
  } })
  rememberRuntimeComposerDraft('account', 'new', { content: 'remaining edits', attachmentIds: [pending.localId], attachments: [pending] })
  rememberRuntimeComposerDraft('account', chatId, { content: 'destination draft', attachmentIds: [], attachments: [] })
  let path = '', navigate!: ReturnType<typeof useNavigate>
  function Chat() {
    path = useLocation().pathname
    navigate = useNavigate()
    const id = path === '/' ? null : path.slice(3)
    return <TooltipProvider><Composer key={id ?? 'new'} chatId={id} modelId="model" /></TooltipProvider>
  }
  const view = render(<MemoryRouter><Chat /></MemoryRouter>)
  await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('remaining edits'))
  view.getByRole('textbox').focus()
  await act(async () => webChatStarted.receive('account', { chatId, responseId: 'remote-response' }))
  expect(path).toBe(`/c/${chatId}`)
  expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('destination draft')
  expect(document.activeElement).toBe(view.getByRole('textbox'))
  expect(runtimeComposerDraft('account', 'new')).toMatchObject({ content: 'remaining edits', attachmentIds: [pending.localId] })
  expect(useUploadOutbox.getState().uploads[pending.localId]?.chatId).toBeNull()
  await act(async () => navigate('/'))
  expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('remaining edits')
  expect(view.getAllByText('remaining.txt').length).toBeGreaterThan(0)
})
