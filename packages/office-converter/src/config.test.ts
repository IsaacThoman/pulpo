import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'

describe('converter configuration', () => {
  it('has safe defaults', () => {
    expect(parseConfig({})).toMatchObject({ port: 8790, token: null, timeoutMs: 60_000, concurrency: 2, maxQueued: 8, maxInputBytes: 100 * 1024 * 1024, maxOutputBytes: 100 * 1024 * 1024 })
    expect(parseConfig({}).memoryLimitMb).toBeUndefined()
    expect(parseConfig({ OFFICE_CONVERTER_MEMORY_LIMIT_MB: '4096' }).memoryLimitMb).toBe(4096)
  })

  it('refuses short tokens, and a missing one where a token is required', () => {
    expect(() => parseConfig({ OFFICE_CONVERTER_TOKEN: 'short' })).toThrow(/at least 32/)
    expect(() => parseConfig({ OFFICE_CONVERTER_REQUIRE_TOKEN: 'true' })).toThrow(/required/)
    expect(parseConfig({ OFFICE_CONVERTER_REQUIRE_TOKEN: 'true', OFFICE_CONVERTER_TOKEN: 'k'.repeat(32) }).token).toBe('k'.repeat(32))
    expect(() => parseConfig({ OFFICE_CONVERTER_CONCURRENCY: '0' })).toThrow(/positive/)
  })
})
