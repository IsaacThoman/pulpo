import { afterEach, describe, expect, it } from 'vitest'
import {
  configureDesktopRuntime,
  runtimeAccountKey,
  runtimeApiUrl,
  runtimeAuthorizationHeaders,
} from './runtime'

function installDesktopWindow(): void {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { pulpoDesktop: { platform: 'desktop' }, location: { origin: 'https://desktop.pulpo.invalid' } },
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('desktop runtime transport', () => {
  it('targets the selected instance and never leaks its bearer token cross-origin', () => {
    installDesktopWindow()
    configureDesktopRuntime({ instanceUrl: 'https://one.example/path', token: 's'.repeat(43) })

    expect(runtimeApiUrl('/api/me')).toBe('https://one.example/api/me')
    expect(runtimeAuthorizationHeaders('/api/me')).toEqual({ authorization: `Bearer ${'s'.repeat(43)}` })
    expect(runtimeAuthorizationHeaders('https://storage.example/object')).toEqual({})
  })

  it('qualifies local account data with the instance origin', () => {
    installDesktopWindow()
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: null })
    expect(runtimeAccountKey('user-1')).toBe('https://one.example|user-1')
  })
})
