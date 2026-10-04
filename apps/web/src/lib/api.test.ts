import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, fetchApiBlob } from './api'
import { configureDesktopRuntime, resetRuntimeClientPlatformForTests } from './runtime'

function installDesktopWindow(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { pulpoDesktop: { platform: 'desktop' }, location: { origin: 'https://desktop.pulpo.invalid' } },
  })
}

afterEach(() => {
  resetRuntimeClientPlatformForTests()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'fetch')
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('desktop resource transport', () => {
  it('keeps browser blob requests relative and cookie-authenticated', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(new Blob(['image'])))
    vi.stubGlobal('fetch', fetchMock)

    await fetchApiBlob('/api/attachments/image')

    expect(fetchMock).toHaveBeenCalledWith('/api/attachments/image', expect.objectContaining({ credentials: 'include' }))
  })

  it('fetches instance blobs with bearer authorization', async () => {
    installDesktopWindow()
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43) })
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(new Blob(['image'], { type: 'image/webp' })))
    vi.stubGlobal('fetch', fetchMock)

    const blob = await fetchApiBlob('/api/users/user/avatar')

    expect(await blob.text()).toBe('image')
    expect(fetchMock).toHaveBeenCalledWith('https://one.example/api/users/user/avatar', expect.objectContaining({
      credentials: 'omit',
      headers: expect.any(Headers),
    }))
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${'s'.repeat(43)}`)
  })

  it('does not send the bearer token to presigned storage', async () => {
    installDesktopWindow()
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43) })
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(new Blob(['image'])))
    vi.stubGlobal('fetch', fetchMock)

    await fetchApiBlob('https://storage.example/object?signature=one')

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('expires the desktop session only for an instance 401', async () => {
    installDesktopWindow()
    const unauthorized = vi.fn()
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43), onUnauthorized: unauthorized })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(fetchApiBlob('/api/users/user/avatar')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledOnce()

    unauthorized.mockClear()
    await expect(fetchApiBlob('https://storage.example/object')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
  })
})

describe('client attribution header', () => {
  function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Headers {
    return new Headers((fetchMock.mock.calls[call]![1] as RequestInit).headers)
  }

  it('marks browser API requests as web', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/api/chats/chat/responses', { method: 'POST', body: { input: 'hi' } })

    expect(sentHeaders(fetchMock).get('x-pulpo-client')).toBe('web')
  })

  it('does not attribute requests outside the instance API', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(new Blob(['x'])))
    vi.stubGlobal('fetch', fetchMock)

    await fetchApiBlob('https://storage.example/api/object')
    await fetchApiBlob('/v1/models')

    expect(sentHeaders(fetchMock, 0).has('x-pulpo-client')).toBe(false)
    expect(sentHeaders(fetchMock, 1).has('x-pulpo-client')).toBe(false)
  })

  it('sends the desktop app version to the configured instance only', async () => {
    installDesktopWindow()
    const appInfo = vi.fn(async () => ({ name: 'Pulpo', version: '1.4.2', packaged: true }))
    Object.assign(window.pulpoDesktop!, { appInfo })
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43) })
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/api/chats/chat/queued-messages', { method: 'POST', body: {} })
    await apiRequest('/api/chats/chat/queued-messages', { method: 'POST', body: {} })
    await fetchApiBlob('https://storage.example/api/object')

    expect(appInfo).toHaveBeenCalledOnce()
    // The version arrives asynchronously; the first request falls back to the bare platform.
    expect(sentHeaders(fetchMock, 0).get('x-pulpo-client')).toBe('desktop')
    expect(sentHeaders(fetchMock, 1).get('x-pulpo-client')).toBe('desktop/1.4.2')
    expect(sentHeaders(fetchMock, 2).has('x-pulpo-client')).toBe(false)
  })
})
