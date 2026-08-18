import { describe, expect, it } from 'vitest'
import { hideProviderApiKey, providerApiKeyPatch } from './provider-key-state'

describe('provider key editor state', () => {
  it('does not send an unchanged or merely revealed saved key', () => {
    expect(providerApiKeyPatch({ apiKey: '', apiKeyChanged: false, hasSavedApiKey: true })).toEqual({})
    expect(providerApiKeyPatch({ apiKey: 'sk-revealed', apiKeyChanged: false, hasSavedApiKey: true })).toEqual({})
  })

  it('sends a replacement key only after it is changed', () => {
    expect(providerApiKeyPatch({ apiKey: 'sk-replacement', apiKeyChanged: true, hasSavedApiKey: true }))
      .toEqual({ apiKey: 'sk-replacement' })
    expect(providerApiKeyPatch({ apiKey: '', apiKeyChanged: true, hasSavedApiKey: true })).toEqual({})
  })

  it('clears a revealed saved key when hidden but retains user-entered values', () => {
    expect(hideProviderApiKey({ apiKey: 'sk-revealed', apiKeyChanged: false, hasSavedApiKey: true }).apiKey).toBe('')
    expect(hideProviderApiKey({ apiKey: 'sk-new', apiKeyChanged: true, hasSavedApiKey: true }).apiKey).toBe('sk-new')
  })
})
