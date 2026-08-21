import { describe, expect, it } from 'vitest'
import { mobileDictationEnabled } from './config.js'

describe('mobile dictation capability', () => {
  it('is advertised when dictation is enabled with a provider key', () => {
    expect(mobileDictationEnabled({ enabled: true, encryptedGroqApiKey: 'encrypted' })).toBe(true)
  })

  it('is hidden when dictation is disabled', () => {
    expect(mobileDictationEnabled({ enabled: false, encryptedGroqApiKey: 'encrypted' })).toBe(false)
  })

  it('is hidden when the provider key is missing', () => {
    expect(mobileDictationEnabled({ enabled: true, encryptedGroqApiKey: null })).toBe(false)
  })
})
