import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchApiBlob } from './api'
import { configureDesktopRuntime } from './runtime'

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
