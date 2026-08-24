import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderLogo } from './ProviderLogo'
import { configureDesktopRuntime } from '@/lib/runtime'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('custom provider icons', () => {
  it('targets the selected instance in desktop mode', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { pulpoDesktop: { platform: 'desktop' }, location: { origin: 'https://desktop.pulpo.invalid' } },
    })
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: null })

    const markup = renderToStaticMarkup(<ProviderLogo provider="custom" customIcon={{
      id: 'icon',
      mode: 'original',
      lightUrl: '/api/catalog-icons/icon/original.png',
      darkUrl: '/api/catalog-icons/icon/original.png',
    }} />)

    expect(markup).toContain('src="https://one.example/api/catalog-icons/icon/original.png"')
    expect(markup).not.toContain('desktop.pulpo.invalid/api')
  })
})
