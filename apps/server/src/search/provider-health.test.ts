import { describe, expect, it } from 'vitest'
import { createProviderHealth } from './provider-health.js'

describe('Search provider health', () => {
  it('skips a provider for a minute after three failures in a row and clears on success', () => {
    let now = 0
    const health = createProviderHealth(() => now)
    health.failed('kagi')
    health.failed('kagi')
    health.succeeded('kagi')
    health.failed('kagi')
    health.failed('kagi')
    expect(health.unhealthy('kagi')).toBe(false)
    health.failed('kagi')
    expect(health.unhealthy('kagi')).toBe(true)
    expect(health.unhealthy('firecrawl')).toBe(false)
    now = 60_001
    expect(health.unhealthy('kagi')).toBe(false)
    // The trial call after the minute fails: skip again right away.
    health.failed('kagi')
    expect(health.unhealthy('kagi')).toBe(true)
    health.succeeded('kagi')
    expect(health.unhealthy('kagi')).toBe(false)
  })
})
