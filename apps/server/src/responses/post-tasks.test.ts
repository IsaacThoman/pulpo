import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODEX_PROVIDER_ID } from '../codex/constants.js'
import type { CatalogModelRuntime } from './catalog-model-runtime.js'

const policy = vi.hoisted(() => ({ enabled: false, selected: null as unknown }))
vi.mock('../codex/policy.js', () => ({ codexEnabled: async () => policy.enabled }))
vi.mock('./catalog-model-runtime.js', async (original) => ({
  ...await original<typeof import('./catalog-model-runtime.js')>(),
  resolveAvailableCatalogModel: async () => policy.selected,
}))

const persistGeneratedChatTitle = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../chats/title-change.js', () => ({ persistGeneratedChatTitle }))

import {
  persistGeneratedTitleResult,
  retryInvalidTitleOutput,
  runPostResponseTasks,
  resolvePostTaskRuntime,
  selectPostTaskRuntime,
  TitleOutputValidationError,
  validateGeneratedTitleResponse,
} from './post-tasks.js'

function runtime(id: string): CatalogModelRuntime {
  return { model: { id }, provider: {} } as CatalogModelRuntime
}

afterEach(() => {
  persistGeneratedChatTitle.mockClear()
})

describe('post-response task model selection', () => {
  it('skips UI-only title tasks for API-originated generations', async () => {
    await expect(runPostResponseTasks({ response: { origin: 'api' } } as never, {} as never, [], 'request-log'))
      .resolves.toBe(0)
  })

  it('uses a fixed available task model', () => {
    const current = runtime('current-model')
    const selected = runtime('small-task-model')
    expect(selectPostTaskRuntime(current, selected)).toBe(selected)
  })

  it('falls back to the completed response model when the selection is unavailable', () => {
    const current = runtime('completed-fallback-model')
    expect(selectPostTaskRuntime(current, null)).toBe(current)
  })

  it('avoids a configured Codex title model while disabled and restores it when enabled', async () => {
    const current = runtime('ordinary')
    const selected = { ...runtime('codex:test'), provider: { id: CODEX_PROVIDER_ID } } as CatalogModelRuntime
    policy.selected = selected
    policy.enabled = false
    expect(await resolvePostTaskRuntime('codex:test', current)).toBe(current)
    policy.enabled = true
    expect(await resolvePostTaskRuntime('codex:test', current)).toBe(selected)
  })

  it('lets a running Codex response finish title tasks using its current model', async () => {
    policy.enabled = false
    const current = { ...runtime('codex:test'), provider: { id: CODEX_PROVIDER_ID } } as CatalogModelRuntime
    expect(await resolvePostTaskRuntime('current', current)).toBe(current)
  })

  it('persists a parsed generated title through the realtime-aware helper', async () => {
    await expect(persistGeneratedTitleResult({
      userId: 'user-1',
      chatId: 'chat-1',
      outputText: '{"title":"  Generated title  "}',
    })).resolves.toBe(true)

    expect(persistGeneratedChatTitle).toHaveBeenCalledWith({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Generated title',
    })
  })

  it('does not persist or publish malformed title output', async () => {
    await expect(persistGeneratedTitleResult({
      userId: 'user-1',
      chatId: 'chat-1',
      outputText: 'A plain title',
    })).resolves.toBe(false)

    expect(persistGeneratedChatTitle).not.toHaveBeenCalled()
  })

  it('rejects malformed, incomplete, and token-limited title responses', () => {
    expect(() => validateGeneratedTitleResponse({ output_text: 'not json' }, 1_024))
      .toThrow('response was not valid title JSON')
    expect(() => validateGeneratedTitleResponse({
      output_text: '{"title":"Truncated"}',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }, 1_024)).toThrow('max_output_tokens')
    expect(() => validateGeneratedTitleResponse({
      output_text: '{"title":"At the limit"}',
      usage: { output_tokens: 1_024 },
    }, 1_024)).toThrow('maximum output token limit reached')
  })

  it('accepts valid title JSON below the output limit', () => {
    expect(validateGeneratedTitleResponse({
      output_text: '{"title":"🐙 Reliable Titles"}',
      usage: { output_tokens: 12 },
    }, 1_024)).toBe('🐙 Reliable Titles')
  })

  it('retries validation failures up to the configured attempt count', async () => {
    const invoke = vi.fn(async (attempt: number) => {
      if (attempt < 2) throw new TitleOutputValidationError('invalid JSON')
      return 'valid title'
    })

    await expect(retryInvalidTitleOutput(invoke)).resolves.toBe('valid title')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1, 2])
  })

  it('does not add semantic retries to provider failures', async () => {
    const invoke = vi.fn(async () => { throw new Error('provider unavailable') })

    await expect(retryInvalidTitleOutput(invoke)).rejects.toThrow('provider unavailable')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

})
