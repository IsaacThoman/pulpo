// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { searchHandoffPath } from '@pulpo/contracts/search'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import {
  clearRuntimeComposerDrafts, NEW_CHAT_DRAFT_ID, rememberRuntimeComposerDraft, runtimeComposerDraft,
} from '@/lib/local-first/composer-drafts'
import type { Model } from '@/lib/types'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { useSettings } from '@/stores/settings'
import { useUploadOutbox } from '@/stores/upload-outbox'
import { SearchHandoffPage } from './SearchHandoffPage'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  })
})
vi.mock('@/components/chat/ModelSelector', () => ({ ModelSelector: () => <button>Choose model</button> }))
vi.mock('@/components/chat/ModelWarningBanner', () => ({ ModelWarningBanner: () => null }))

const userId = '00000000-0000-4000-8000-000000000001'

afterEach(() => {
  cleanup()
  clearRuntimeComposerDrafts(userId)
  vi.restoreAllMocks()
})

it('keeps a search message in its own draft until the user explicitly sends it', () => {
  const model = { id: 'test', enabled: true, agentEnabled: true, presets: [] } as unknown as Model
  useCatalog.setState({ models: [model], loaded: true, agentAvailable: true })
  useAuth.setState({ instanceReady: true })
  useSettings.setState({ defaultModelId: model.id, newChatAutoExpire: true, automaticChatExpiration: '24h' })
  const stage = vi.spyOn(useUploadOutbox.getState(), 'stageSubmission')
    .mockReturnValue({ chatId: 'started', submissionId: 'sent' })
  const original = { content: 'Unsent work in my main new chat', attachments: [], attachmentIds: [] }
  rememberRuntimeComposerDraft(userId, NEW_CHAT_DRAFT_ID, original)
  const source = 'https://www.nps.gov/tide-pools.htm'
  const url = searchHandoffPath({ query: 'Explain tide pools', sources: [source] })

  render(<MemoryRouter initialEntries={[url]}><Routes>
    <Route path="/search/ask" element={<SearchHandoffPage />} />
    <Route path="/c/started" element={<p>Started chat</p>} />
  </Routes></MemoryRouter>)

  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'New chat draft' })
  expect(input.value).toContain('Explain tide pools')
  expect(input.value).toContain(source)
  fireEvent.change(input, { target: { value: 'Give me a short explanation.\n' + source } })
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }))
  expect(stage).not.toHaveBeenCalled()
  expect(runtimeComposerDraft(userId, NEW_CHAT_DRAFT_ID)).toEqual(original)

  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(stage).toHaveBeenCalledExactlyOnceWith({
    chatId: null,
    content: 'Give me a short explanation.\n' + source,
    modelId: model.id,
    presetSelections: {},
    agentMode: true,
    temporary: false,
    autoExpire: true,
    attachmentIds: [],
  })
  expect(screen.getByText('Started chat')).toBeTruthy()
  expect(runtimeComposerDraft(userId, NEW_CHAT_DRAFT_ID)).toEqual(original)
})
