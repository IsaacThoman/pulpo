import { describe, expect, it } from 'vitest'
import { namespacePublicRequestIdentifiers } from './request-identifiers.js'

describe('public request identifiers', () => {
  it('derives stable opaque identifiers per API key', () => {
    const parameters = { prompt_cache_key: 'customer-1', safety_identifier: 'person-1', temperature: 0.2 }
    const first = namespacePublicRequestIdentifiers(parameters, 'key-a')
    const repeated = namespacePublicRequestIdentifiers(parameters, 'key-a')
    const otherKey = namespacePublicRequestIdentifiers(parameters, 'key-b')

    expect(first).toEqual(repeated)
    expect(first.prompt_cache_key).not.toBe(parameters.prompt_cache_key)
    expect(first.safety_identifier).not.toBe(parameters.safety_identifier)
    expect(first).not.toEqual(otherKey)
    expect(String(first.prompt_cache_key).length).toBeLessThanOrEqual(64)
    expect(String(first.safety_identifier).length).toBeLessThanOrEqual(64)
    expect(first.temperature).toBe(0.2)
    expect(parameters).toEqual({ prompt_cache_key: 'customer-1', safety_identifier: 'person-1', temperature: 0.2 })
  })

  it('leaves absent and non-string values untouched', () => {
    expect(namespacePublicRequestIdentifiers({ include: ['reasoning.encrypted_content'] }, 'key-a'))
      .toEqual({ include: ['reasoning.encrypted_content'] })
    expect(namespacePublicRequestIdentifiers({ prompt_cache_key: null }, 'key-a'))
      .toEqual({ prompt_cache_key: null })
  })
})
