import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/client.js', () => ({ db: {} }))

import { AppError } from '../lib/errors.js'
import { assertModelsAvailableOnPlatform, isModelHiddenOnPlatform, modelPlatformForClient, modelShownOnPlatformCondition } from './model-platforms.js'

function databaseWith(rows: Array<{ hiddenPlatforms: unknown }>) {
  const where = vi.fn(async () => rows)
  const select = vi.fn(() => ({ from: () => ({ where }) }))
  return { database: { select } as never, select }
}

describe('model platform visibility', () => {
  it('only treats native store apps as platforms that can hide models', () => {
    expect(modelPlatformForClient({ platform: 'ios' })).toBe('ios')
    expect(modelPlatformForClient({ platform: 'android' })).toBe('android')
    for (const platform of ['web', 'desktop', 'cli', 'api', 'unknown'] as const) {
      expect(modelPlatformForClient({ platform })).toBeNull()
    }
    expect(modelPlatformForClient(null)).toBeNull()
    expect(modelShownOnPlatformCondition(null)).toBeUndefined()
    expect(modelShownOnPlatformCondition('ios')).toBeDefined()
  })

  it('matches a model’s hidden platform list', () => {
    expect(isModelHiddenOnPlatform({ hiddenPlatforms: ['ios'] }, 'ios')).toBe(true)
    expect(isModelHiddenOnPlatform({ hiddenPlatforms: ['ios'] }, 'android')).toBe(false)
    expect(isModelHiddenOnPlatform({ hiddenPlatforms: ['ios'] }, null)).toBe(false)
    expect(isModelHiddenOnPlatform({ hiddenPlatforms: null }, 'ios')).toBe(false)
  })

  it('rejects a store app that names a model hidden on its platform', async () => {
    const { database } = databaseWith([{ hiddenPlatforms: [] }, { hiddenPlatforms: ['android'] }])
    const rejected = assertModelsAvailableOnPlatform(['visible', 'redirect-target'], { platform: 'android' }, database)
    await expect(rejected).rejects.toBeInstanceOf(AppError)
    await expect(rejected).rejects.toMatchObject({ statusCode: 403, code: 'model_unavailable_on_platform' })
    await expect(assertModelsAvailableOnPlatform(['visible'], { platform: 'ios' }, database)).resolves.toBeUndefined()
  })

  it('skips the lookup for clients that never hide models', async () => {
    const { database, select } = databaseWith([{ hiddenPlatforms: ['ios'] }])
    await assertModelsAvailableOnPlatform(['model'], { platform: 'web' }, database)
    await assertModelsAvailableOnPlatform(['model'], null, database)
    await assertModelsAvailableOnPlatform([null, undefined], { platform: 'ios' }, database)
    expect(select).not.toHaveBeenCalled()
  })
})
