import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModelRuntime } from './catalog-model-runtime.js'

const persistGeneratedChatTitle = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../chats/title-change.js', () => ({ persistGeneratedChatTitle }))

import {
  extractedMemoryFacts,
  memoryExtractionPrompt,
  persistGeneratedTitleResult,
  retryInvalidTitleOutput,
  runPostResponseTasks,
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
  it('skips UI-only title and memory tasks for API-originated generations', async () => {
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

  it('gives explicit user confirmations narrowly scoped preceding assistant context', () => {
    const prompt = memoryExtractionPrompt(
      "that's me",
      'The person is Isaac Thoman, who attended KSU and interned at State Farm.',
    )
    expect(prompt).toContain("CURRENT USER MESSAGE:\nthat's me")
    expect(prompt).toContain('The person is Isaac Thoman')
    expect(prompt).toContain('does not confirm every incidental school, employer, location, or biographical detail')
    expect(prompt).toContain('Never save a claim from it unless the current user clearly confirms')
  })

  it('persists only explicitly user-supported memory extraction results', () => {
    expect(extractedMemoryFacts([
      { fact: 'The user confirmed they are Isaac Thoman.', basis: 'explicit_user_confirmation' },
      { fact: 'The user attended KSU.', basis: 'assistant_inference' },
      { fact: 'The user likes concise answers.', basis: 'explicit_user_statement' },
      'The user lives in Atlanta.',
    ])).toEqual([
      'The user confirmed they are Isaac Thoman.',
      'The user likes concise answers.',
    ])
  })
})
