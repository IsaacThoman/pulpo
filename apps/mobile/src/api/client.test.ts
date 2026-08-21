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

describe('multipart API requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureApi({ instanceUrl: 'https://pulpo.baby', token: null })
  })

  it('preserves FormData and lets fetch assign the multipart boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'hello' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    configureApi({ instanceUrl: 'https://chat.example.test', token: 'session-token' })
    const form = new FormData()
    form.append('file', new Blob(['audio'], { type: 'audio/mp4' }), 'dictation.m4a')

    await expect(apiRequest('/api/dictation/transcriptions', {
      method: 'POST', body: form, timeoutMs: 45_000,
    })).resolves.toEqual({ text: 'hello' })

    const request = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = new Headers(request.headers)
    expect(request.body).toBe(form)
    expect(headers.get('content-type')).toBeNull()
    expect(headers.get('authorization')).toBe('Bearer session-token')
  })

  it('keeps server error details for multipart failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'dictation_no_speech', message: 'No speech was detected in the recording' },
    }), { status: 422, headers: { 'content-type': 'application/json' } })))

    await expect(apiRequest('/api/dictation/transcriptions', {
      method: 'POST', body: new FormData(),
    })).rejects.toMatchObject({
      status: 422,
      code: 'dictation_no_speech',
      message: 'No speech was detected in the recording',
    })
  })
})

describe('mobile dictation capability discovery', () => {
  const baseConfig = {
    mobileApiVersion: 1 as const,
    instance: { name: 'Pulpo', version: '0.1.0', publicUrl: 'https://chat.example.test' },
    setupRequired: false,
    auth: { signupEnabled: true, pendingDetails: false, adminEmail: '', pendingMessage: '' },
    limits: { maxAttachmentBytes: 25 * 1024 * 1024 },
    capabilities: {
      bearerSessions: true as const,
      realtime: true as const,
      chatDuplication: true as const,
      publicSharing: true as const,
      attachments: true as const,
      folders: true as const,
      twoFactorAuth: true,
      passkeys: true,
      dictation: false,
    },
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    configureApi({ instanceUrl: 'https://pulpo.baby', token: null })
  })

  it('falls back to the existing web setting on servers without the mobile capability', async () => {
    const legacyConfig = {
      ...baseConfig,
      capabilities: Object.fromEntries(
        Object.entries(baseConfig.capabilities).filter(([key]) => key !== 'dictation'),
      ),
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(legacyConfig), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dictationEnabled: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    configureApi({ instanceUrl: 'https://chat.example.test', token: 'session-token' })

    await expect(mobileApi.config()).resolves.toMatchObject({ capabilities: { dictation: true } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('https://chat.example.test/api/auth/settings')
    expect(new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).get('authorization')).toBeNull()
  })

  it('uses the native capability without an extra settings request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...baseConfig,
      capabilities: { ...baseConfig.capabilities, dictation: true },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(mobileApi.config()).resolves.toMatchObject({ capabilities: { dictation: true } })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
