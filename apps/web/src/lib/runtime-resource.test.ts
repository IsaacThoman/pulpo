import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureDesktopRuntime } from './runtime'
import { createRuntimeImageResource } from './runtime-resource'

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

describe('runtime image resources', () => {
  it('creates and revokes an authenticated blob URL', async () => {
    installDesktopWindow()
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['image']))))
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:desktop-image')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const resource = createRuntimeImageResource('/api/attachments/image/thumbnail', true)

    await expect(resource.load()).resolves.toBe('blob:desktop-image')
    expect(createObjectURL).toHaveBeenCalledOnce()
    resource.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:desktop-image')
  })

  it('aborts a pending request without producing a stale URL', async () => {
    installDesktopWindow()
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43) })
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init.signal ?? undefined
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    const resource = createRuntimeImageResource('/api/attachments/image/thumbnail', true)
    const loading = resource.load()

    resource.dispose()

    await expect(loading).resolves.toBeNull()
    expect(requestSignal?.aborted).toBe(true)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps browser protected-image URLs relative', async () => {
    const resource = createRuntimeImageResource('/api/users/user/avatar', true)
    await expect(resource.load()).resolves.toBe('/api/users/user/avatar')
    resource.dispose()
  })
})
