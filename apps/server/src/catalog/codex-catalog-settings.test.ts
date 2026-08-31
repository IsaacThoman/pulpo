import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  codexInsert: undefined as Record<string, unknown> | undefined,
  codexConflictUpdate: undefined as Record<string, unknown> | undefined,
}))

vi.mock('@earendil-works/pi-ai/providers/openai-codex', () => ({
  openaiCodexProvider: () => ({
    getModels: () => [{
      id: 'gpt-test', name: 'GPT Test', contextWindow: 128_000, maxTokens: 16_384,
      input: ['text'], reasoning: true,
    }],
  }),
}))
vi.mock('@earendil-works/pi-ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('@earendil-works/pi-ai')>(),
  getSupportedThinkingLevels: () => ['medium'],
}))
vi.mock('../database/client.js', () => {
  const emptyQuery = () => {
    const result = {
      limit: vi.fn(async () => []),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve([]).then(resolve, reject),
    }
    return result
  }
  const tx = {
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        if (typeof value.id === 'string' && value.id.startsWith('codex:')) mocks.codexInsert = value
        return {
          onConflictDoNothing: vi.fn(async () => undefined),
          onConflictDoUpdate: vi.fn(async (options: { set: Record<string, unknown> }) => {
            if (typeof value.id === 'string' && value.id.startsWith('codex:')) mocks.codexConflictUpdate = options.set
          }),
        }
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(emptyQuery) })) })),
  }
  return { db: { transaction: vi.fn(async (fn: (value: typeof tx) => Promise<void>) => fn(tx)) } }
})

import { ensureBuiltinCatalog } from './defaults.js'

describe('managed Codex catalog settings', () => {
  beforeEach(() => {
    mocks.codexInsert = undefined
    mocks.codexConflictUpdate = undefined
  })

  it('forces compaction on while preserving customized threshold and retention values', async () => {
    await ensureBuiltinCatalog()
    expect(mocks.codexInsert).toMatchObject({ compactionEnabled: true })
    expect(mocks.codexConflictUpdate).toMatchObject({ compactionEnabled: true })
    expect(mocks.codexConflictUpdate).not.toHaveProperty('compactionThresholdTokens')
    expect(mocks.codexConflictUpdate).not.toHaveProperty('compactionRetainedTurns')
  })
})
