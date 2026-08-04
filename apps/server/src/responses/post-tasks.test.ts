import { describe, expect, it } from 'vitest'
import type { CatalogModelRuntime } from './catalog-model-runtime.js'
import { selectPostTaskRuntime } from './post-tasks.js'

function runtime(id: string): CatalogModelRuntime {
  return { model: { id }, provider: {} } as CatalogModelRuntime
}

describe('post-response task model selection', () => {
  it('uses a fixed available task model', () => {
    const current = runtime('current-model')
    const selected = runtime('small-task-model')
    expect(selectPostTaskRuntime(current, selected)).toBe(selected)
  })

  it('falls back to the completed response model when the selection is unavailable', () => {
    const current = runtime('completed-fallback-model')
    expect(selectPostTaskRuntime(current, null)).toBe(current)
  })
})
