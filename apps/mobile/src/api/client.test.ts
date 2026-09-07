import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, apiUrl, configureApi, isNetworkError, mobileApi, nativeAuthorizationHeaders } from './client'

describe('chat transfer during navigation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); configureApi({ instanceUrl: 'https://pulpo.baby', token: null }) })
  it('downloads the response before allowing JSON decoding', async () => {
    const payload = '{"id":"prepared-chat","responses":[]}'
    const text = vi.fn().mockResolvedValue(payload)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, text }))
    const parse = vi.spyOn(JSON, 'parse')
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const request = mobileApi.chat('prepared-chat', undefined, () => ready)
    await vi.waitFor(() => expect(text).toHaveBeenCalledOnce())
    expect(parse.mock.calls.some(([input]) => input === payload)).toBe(false)
    release()
    await expect(request).resolves.toEqual({ id: 'prepared-chat', responses: [] })
    expect(parse).toHaveBeenCalledWith(payload)
  })
  it('does not process a stale authentication response after cancellation', async () => {
    const unauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://old.example', token: 'old', onUnauthorized: unauthorized })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'unauthorized' } }, { status: 401 })))
    const controller = new AbortController()
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const request = mobileApi.chat('a', controller.signal, () => ready)
    controller.abort(); release()
    await expect(request).rejects.toThrow('cancelled')
    expect(unauthorized).not.toHaveBeenCalled()
  })
  it('keeps cancellation connected while the response body is downloading', async () => {
    let bodySignal: AbortSignal | undefined
    const text = vi.fn(() => new Promise<string>((_resolve, reject) => {
      bodySignal!.addEventListener('abort', () => reject(new Error('body cancelled')), { once: true })
    }))
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      bodySignal = options.signal
      return { status: 200, ok: true, text }
    }))
    const controller = new AbortController()
    const ready = vi.fn().mockResolvedValue(undefined)
    const request = mobileApi.chat('a', controller.signal, ready)
    await vi.waitFor(() => expect(text).toHaveBeenCalledOnce())
    controller.abort()
    await expect(request).rejects.toThrow('body cancelled')
    expect(bodySignal!.aborted).toBe(true)
    expect(ready).not.toHaveBeenCalled()
  })
})

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

describe('device metadata on native authentication', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each(['ios', 'android'] as const)('sends %s metadata on password, signup, and both passkey flows', async (platform) => {
    const fetchMock = vi.fn(async () => Response.json({ user: {}, session: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const device = { platform }
    await mobileApi.login('me@example.test', 'password', 'My phone', undefined, device)
    await mobileApi.signup('Me', 'member', 'me@example.test', 'password', 'My phone', device)
    await mobileApi.verifyPasskey('ceremony', { id: 'key' } as never, 'My phone', device)
    await mobileApi.exchangeBrowserPasskey('code', 'verifier', 'My phone', device)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    for (const call of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(JSON.parse(call[1].body as string)).toMatchObject({ deviceLabel: 'My phone', appType: 'mobile', platform })
    }
  })
})


describe('profile request isolation', () => {
  it('discards a downloaded chat when its deferred decode resumes in another profile', async () => {
    const { configureDataProfile } = await import('@pulpo/client-core')
    let resume!: () => void
    const beforeDecode = vi.fn(() => new Promise<void>((resolve) => { resume = resolve }))
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: ['personal chat'] })))
    configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'personal' })
    try {
      const pending = apiRequest('/api/chats/chat', { beforeDecode, signal: controller.signal })
      await vi.waitFor(() => expect(beforeDecode).toHaveBeenCalledOnce())
      configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'work' })
      resume()
      await expect(pending).rejects.toMatchObject({ code: 'profile_changed' })
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    } finally {
      configureDataProfile(undefined)
      vi.unstubAllGlobals()
    }
  })

  it('discards late profile responses while keeping bearer authentication shared', async () => {
    const { configureDataProfile } = await import('@pulpo/client-core')
    let finish!: (response: Response) => void
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    configureApi({ instanceUrl: 'https://pulpo.test', token: 'shared-session' })
    configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'personal' })
    const pending = apiRequest('/api/chats')
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('X-Pulpo-Profile-Id')).toBe('personal')
    expect(headers.get('authorization')).toBe('Bearer shared-session')
    configureDataProfile({ instance: 'https://pulpo.test', userId: 'owner', profileId: 'work' })
    finish(new Response(JSON.stringify({ data: ['private'] })))
    await expect(pending).rejects.toMatchObject({ code: 'profile_changed' })
    configureDataProfile(undefined)
    configureApi({ instanceUrl: 'https://pulpo.baby', token: null })
    vi.unstubAllGlobals()
  })
})
