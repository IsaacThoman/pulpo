import { describe, expect, it } from 'vitest'
import {
  DESKTOP_ORIGIN,
  desktopDevelopmentRequestHeaders,
  desktopDevelopmentResponseHeaders,
  desktopPermissionAllowed,
  isTrustedRendererUrl,
  rendererAssetPath,
  validatedExternalUrl,
  validatedProtocolUrl,
} from './security'

describe('desktop security helpers', () => {
  it('accepts only trusted renderer origins', () => {
    expect(isTrustedRendererUrl(`${DESKTOP_ORIGIN}/c/one`)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/', 'http://localhost:5174')).toBe(true)
    expect(isTrustedRendererUrl('https://pulpo.example/')).toBe(false)
  })

  it('allows clipboard writes only from trusted renderers', () => {
    expect(desktopPermissionAllowed(`${DESKTOP_ORIGIN}/c/one`, 'clipboard-sanitized-write')).toBe(true)
    expect(desktopPermissionAllowed('http://localhost:5174/c/one', 'clipboard-sanitized-write', undefined, 'http://localhost:5174')).toBe(true)
    expect(desktopPermissionAllowed('https://pulpo.example/c/one', 'clipboard-sanitized-write')).toBe(false)
    expect(desktopPermissionAllowed(`${DESKTOP_ORIGIN}/c/one`, 'clipboard-read')).toBe(false)
  })

  it('keeps desktop media access limited to audio', () => {
    expect(desktopPermissionAllowed(DESKTOP_ORIGIN, 'media', ['audio'])).toBe(true)
    expect(desktopPermissionAllowed(DESKTOP_ORIGIN, 'media', ['video'])).toBe(false)
    expect(desktopPermissionAllowed(DESKTOP_ORIGIN, 'media', ['audio', 'video'])).toBe(false)
  })

  it('bridges the local renderer through the trusted desktop CORS origin', () => {
    expect(desktopDevelopmentRequestHeaders({ Origin: 'http://localhost:5174' }, 'http://localhost:5174/')).toEqual({
      Origin: DESKTOP_ORIGIN,
    })
    expect(desktopDevelopmentRequestHeaders({ Origin: 'https://untrusted.example' }, 'http://localhost:5174')).toEqual({
      Origin: 'https://untrusted.example',
    })
    expect(desktopDevelopmentResponseHeaders({
      'access-control-allow-origin': [DESKTOP_ORIGIN],
      vary: ['Origin'],
    }, 'http://localhost:5174/')).toEqual({
      'access-control-allow-origin': ['http://localhost:5174'],
      vary: ['Origin'],
    })
  })

  it('rejects insecure external destinations and credentials', () => {
    expect(validatedExternalUrl('https://pulpo.baby/support', false)).toBe('https://pulpo.baby/support')
    expect(() => validatedExternalUrl('http://pulpo.baby', false)).toThrow()
    expect(() => validatedExternalUrl('https://user:secret@pulpo.baby', false)).toThrow()
    expect(validatedExternalUrl('http://localhost:3000', true)).toBe('http://localhost:3000/')
  })

  it('accepts only passkey callbacks and safe renderer paths', () => {
    expect(validatedProtocolUrl('pulpo://auth/passkey?state=one')).toContain('/passkey')
    expect(() => validatedProtocolUrl('pulpo://evil/passkey')).toThrow()
    expect(rendererAssetPath('/assets/app.js')).toBe('assets/app.js')
    expect(rendererAssetPath('/%2e%2e/secrets')).toBeNull()
  })
})
