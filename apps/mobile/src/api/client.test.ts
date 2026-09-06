import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, apiUrl, configureApi, isNetworkError, mobileApi, nativeAuthorizationHeaders } from './client'

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

describe('security form authentication errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureApi({ instanceUrl: 'https://pulpo.baby', token: null })
  })

  const rejectedPassword = () => Response.json({ error: { code: 'unauthorized', message: 'Current password is incorrect' } }, { status: 401 })

  it('keeps a valid session signed in when a passkey password check fails', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'test-session', onUnauthorized })
    const fetch = vi.fn().mockResolvedValueOnce(rejectedPassword()).mockResolvedValueOnce(Response.json({ user: { id: 'member' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(mobileApi.beginPasskeyRegistration('Test', 'incorrect')).rejects.toThrow('Current password is incorrect')
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://fixture.example/api/me/passkeys/registration/options', 'https://fixture.example/api/mobile/me'])
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('signs out when the security request and session verification both reject the session', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'expired', onUnauthorized })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rejectedPassword()).mockResolvedValueOnce(Response.json({ error: { code: 'unauthorized' } }, { status: 401 })))
    await expect(mobileApi.beginTwoFactorEnrollment('incorrect')).rejects.toThrow('Current password is incorrect')
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('preserves the form error when session verification cannot reach the server', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'test-session', onUnauthorized })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(rejectedPassword()).mockRejectedValueOnce(new TypeError('Network request failed')))
    await expect(mobileApi.changePassword('incorrect', 'test-replacement')).rejects.toThrow('Current password is incorrect')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('still signs out directly for an ordinary authenticated request with an expired session', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'expired', onUnauthorized })
    const fetch = vi.fn().mockResolvedValueOnce(rejectedPassword())
    vi.stubGlobal('fetch', fetch)
    await expect(apiRequest('/api/chats')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
