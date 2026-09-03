// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Composer } from './Composer'

const testState = vi.hoisted(() => {
  const noop = vi.fn()
  return {
    noop,
    drafts: new Map<string, Record<string, unknown>>(),
    loadLocalComposerDraft: vi.fn(),
    saveLocalComposerDraft: vi.fn(),
    saveRemoteComposerDraft: vi.fn(),
    chat: {
      chats: [],
      streamingIds: [],
      stopStreaming: noop,
      updateQueuedMessage: noop,
      reorderQueuedMessage: noop,
      deleteQueuedMessage: noop,
      editUserMessage: noop,
      setComposerModel: noop,
    },
    settings: {
      generation: {},
      sendWithEnter: false,
      agentModes: {},
      syncDrafts: true,
      localAttachmentCacheMb: 64,
    },
    uploads: {
      uploads: {},
      submissions: [],
      addFiles: vi.fn(() => []),
      addExistingAttachments: vi.fn(() => []),
      removeUpload: noop,
      releaseDraftUploads: noop,
      consumeUploads: noop,
      stageSubmission: noop,
      resumeSubmission: noop,
      retryUpload: noop,
      returnSubmissionToComposer: noop,
      discardSubmission: noop,
      preserveComposerDraft: noop,
      takePreservedComposerDraft: vi.fn(() => null),
      retainDraftAfterSubmission: noop,
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ isSuccess: false, data: undefined }),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => testState.noop }))
vi.mock('@/i18n/useAppTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n/ui', () => ({
  ui: (value: string) => value,
  uit: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (result, part, index) => `${result}${part}${index < values.length ? String(values[index]) : ''}`,
    '',
  ),
}))

vi.mock('@/stores/chat', () => ({
  useChat: Object.assign((selector: (state: typeof testState.chat) => unknown) => selector(testState.chat), {
    getState: () => testState.chat,
  }),
}))

vi.mock('@/stores/settings', () => ({
  useSettings: Object.assign((selector: (state: typeof testState.settings) => unknown) => selector(testState.settings), {
    getState: () => testState.settings,
  }),
}))

vi.mock('@/stores/modelConfig', () => ({
  useModelConfig: Object.assign(
    (selector: (state: { overrides: Record<string, never> }) => unknown) => selector({ overrides: {} }),
    { getState: () => ({ overrides: {} }) },
  ),
  chatOptionsFor: () => ({ presets: [] }),
  resolveSelections: () => ({}),
}))

vi.mock('@/stores/catalog', () => ({
  useCatalog: Object.assign(
    (selector: (state: { agentAvailable: boolean }) => unknown) => selector({ agentAvailable: false }),
    { getState: () => ({ agentAvailable: false }) },
  ),
  getCatalogModel: () => ({ agentEnabled: false }),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: Object.assign(
    (selector: (state: { user: { id: string }; dictationEnabled: boolean; instanceReady: boolean }) => unknown) => selector({
      user: { id: 'composer-test-user' }, dictationEnabled: false, instanceReady: true,
    }),
    { getState: () => ({ user: { id: 'composer-test-user' } }) },
  ),
}))

vi.mock('@/stores/upload-outbox', () => ({
  useUploadOutbox: Object.assign(
    (selector: (state: typeof testState.uploads) => unknown) => selector(testState.uploads),
    { getState: () => testState.uploads },
  ),
}))

vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('@/lib/realtime-client-id', () => ({ webRealtimeClientId: () => 'composer-test-editor' }))
vi.mock('@/lib/api', () => ({ apiRequest: testState.noop }))

vi.mock('@/lib/local-first/composer-drafts', () => ({
  WEB_COMPOSER_DRAFT_CHANGED_EVENT: 'pulpo:composer-draft-changed',
  WEB_COMPOSER_DRAFTS_CLEARED_EVENT: 'pulpo:composer-drafts-cleared',
  peekRuntimeComposerDraft: (_userId: string, scope: string) => testState.drafts.get(scope) ?? null,
  loadLocalComposerDraft: testState.loadLocalComposerDraft,
  saveLocalComposerDraft: testState.saveLocalComposerDraft,
  saveRemoteComposerDraft: testState.saveRemoteComposerDraft,
  saveLocalComposerTombstone: vi.fn(async () => undefined),
  deleteLocalComposerDraft: vi.fn(async (_userId: string, scope: string) => { testState.drafts.delete(scope) }),
  deleteRemoteComposerDraft: vi.fn(async () => 1),
  detachSyncedDraftAttachments: vi.fn(async () => null),
  fetchRemoteComposerDraft: vi.fn(async () => ({ draft: null, revision: 0 })),
  loadDraftFile: vi.fn(async () => null),
  reconcileWebComposerDraftSnapshot: vi.fn(async () => undefined),
}))

function storedDraft(input: Record<string, unknown>) {
  return {
    ...input,
    chatId: input.scope,
    attachments: [],
    deleted: false,
    updatedAt: Date.now(),
  }
}

async function settleEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function composerSurface(key: string, chatId: string | null) {
  return <TooltipProvider><Composer key={key} chatId={chatId} modelId="model-1" /></TooltipProvider>
}

describe('Composer draft lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    testState.drafts.clear()
    testState.loadLocalComposerDraft.mockReset().mockImplementation(async (_userId: string, scope: string) => (
      testState.drafts.get(scope) ?? null
    ))
    testState.saveLocalComposerDraft.mockReset().mockImplementation(async (input: Record<string, unknown>) => {
      testState.drafts.set(String(input.scope), storedDraft(input))
    })
    testState.saveRemoteComposerDraft.mockReset().mockImplementation(async (scope: string, input: Record<string, unknown>) => ({
      ...input,
      scope,
      attachments: [],
      revision: 7,
      updatedAt: new Date(7_000).toISOString(),
    }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not schedule another cloud write when an acknowledgement rerenders the composer', async () => {
    const view = render(composerSurface('new', null))
    await settleEffects()

    fireEvent.change(view.getByRole('textbox'), { target: { value: 'one intentional edit' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })

    expect(testState.saveRemoteComposerDraft).toHaveBeenCalledOnce()

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(testState.saveRemoteComposerDraft).toHaveBeenCalledOnce()
  })

  it('flushes an edit before switching scopes and restores it when returning', async () => {
    const view = render(composerSurface('chat-a', 'chat-a'))
    await settleEffects()

    fireEvent.change(view.getByRole('textbox'), { target: { value: 'keep this per-chat draft' } })
    view.rerender(composerSurface('chat-b', 'chat-b'))
    await settleEffects()

    expect(testState.drafts.get('chat-a')).toMatchObject({ content: 'keep this per-chat draft' })
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')

    view.rerender(composerSurface('chat-a', 'chat-a'))
    await settleEffects()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('keep this per-chat draft')
  })
})
