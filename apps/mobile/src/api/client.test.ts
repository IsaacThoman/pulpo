import { afterEach, describe, expect, it } from 'vitest'
import { ApiError, apiUrl, configureApi, isNetworkError, nativeAuthorizationHeaders } from './client'

describe('attachment URL resolution', () => {
  afterEach(() => configureApi({ instanceUrl: 'https://pulpo.baby', token: null }))

  it('resolves local blob-store paths against the configured instance', () => {
    configureApi({ instanceUrl: 'https://chat.example.test', token: 'session-token' })

    expect(apiUrl('/api/attachments/local-download/file-key'))
      .toBe('https://chat.example.test/api/attachments/local-download/file-key')
    expect(nativeAuthorizationHeaders('/api/attachments/local-download/file-key'))
      .toEqual({ authorization: 'Bearer session-token' })
  })

  it('does not send the session token to an external signed URL', () => {
    configureApi({ instanceUrl: 'https://chat.example.test', token: 'session-token' })

    expect(apiUrl('https://objects.example.test/signed-file')).toBe('https://objects.example.test/signed-file')
    expect(nativeAuthorizationHeaders('https://objects.example.test/signed-file')).toEqual({})
  })
})

describe('native network error detection', () => {
  it('recognizes the Expo iOS fetch exception used while offline', () => {
    expect(isNetworkError(new Error(
      "fetch failed: UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)",
    ))).toBe(true)
  })

  it('keeps validation and authorization errors out of the offline queue', () => {
    expect(isNetworkError(new Error('The selected model is unavailable'))).toBe(false)
    expect(isNetworkError(new ApiError(401, 'unauthorized', 'Unauthorized'))).toBe(false)
  })
})
