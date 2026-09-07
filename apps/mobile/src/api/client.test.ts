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

describe('multipart requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); configureApi({ instanceUrl: 'https://pulpo.baby', token: null }) })
  it('sends the form unchanged with bearer auth and a generated content-type boundary', async () => {
    configureApi({ instanceUrl: 'https://fixture.example', token: 'test-session' })
    const fetch = vi.fn(async () => Response.json({ text: 'Transcript' }))
    vi.stubGlobal('fetch', fetch)
    const form = new FormData()
    form.append('file', new Blob(['audio'], { type: 'audio/mp4' }), 'dictation.m4a')
    await expect(apiRequest('/api/dictation/transcriptions', { method: 'POST', body: form, headers: { 'content-type': 'application/json' } })).resolves.toEqual({ text: 'Transcript' })
    const options = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(options.body).toBe(form)
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer test-session')
    expect(new Headers(options.headers).has('content-type')).toBe(false)
  })
  it('honors cancellation that happened before the request started', async () => {
    const abort = new AbortController(); abort.abort()
    const fetch = vi.fn(async (_url, options) => {
      expect(options.signal.aborted).toBe(true)
      throw new DOMException('Aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(apiRequest('/api/dictation/transcriptions', { method: 'POST', body: new FormData(), signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('does not sign out a replacement session when an old upload returns 401', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'old', onUnauthorized })
    let respond!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
    const request = apiRequest('/api/dictation/transcriptions', { method: 'POST', body: new FormData() })
    configureApi({ instanceUrl: 'https://fixture.example', token: 'new', onUnauthorized })
    respond(Response.json({ error: { message: 'Expired' } }, { status: 401 }))
    await expect(request).rejects.toThrow('Expired')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('keeps the timeout active while waiting for the response body', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      status: 200, ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
    })))
    const request = apiRequest('/api/dictation/transcriptions', { method: 'POST', body: new FormData(), timeoutMs: 45_000 })
    const rejected = expect(request).rejects.toMatchObject({ code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(45_000); await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses the dictation timeout without retrying or leaving timers behind', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetch)
    const request = apiRequest('/api/dictation/transcriptions', { method: 'POST', body: new FormData(), timeoutMs: 45_000 })
    const rejected = expect(request).rejects.toMatchObject({ code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(45_000); await rejected
    expect(fetch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
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

describe('session changes during requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureApi({ instanceUrl: 'https://pulpo.baby', token: null })
  })

  it('ignores an old session rejection after signing in again', async () => {
    const onUnauthorized = vi.fn()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'old', onUnauthorized })
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const request = mobileApi.me()
    configureApi({ instanceUrl: 'https://fixture.example', token: 'new', onUnauthorized })
    resolve(Response.json({ error: { code: 'unauthorized' } }, { status: 401 }))
    await expect(request).rejects.toThrow()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
