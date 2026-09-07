import { describe, expect, it, vi } from 'vitest'
import { deviceSessionSchema } from '@pulpo/contracts'
import type { sessions } from '../database/schema.js'
vi.mock('../responses/events.js', () => ({ publishSessionRevocation: vi.fn() }))
import { serializeDeviceSession } from './device-sessions.js'

const base: typeof sessions.$inferSelect = {
  id: '11111111-1111-4111-8111-111111111111', userId: 'owner', tokenHash: 'secret',
  deviceLabel: null, appType: null, platform: null, latestIpAddress: null,
  ipAddress: '127.0.0.1', userAgent: null, createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(),
}
describe('device summaries', () => {
  it('keeps legacy unknown data and exposes no secrets', () => {
    const value = serializeDeviceSession(base, base.id)
    expect(value).toMatchObject({ isCurrent: true, deviceLabel: 'Unknown device', platform: 'unknown', appType: 'unknown', latestIp: null })
    expect(value).not.toHaveProperty('tokenHash')
    expect(value).not.toHaveProperty('userId')
    expect(deviceSessionSchema.parse(value)).toEqual(value)
  })
  it.each([
    ['Chrome', 'windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'],
    ['Safari', 'ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'],
    ['Firefox', 'linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'],
  ])('identifies %s web sessions on %s', (browser, platform, userAgent) => {
    expect(serializeDeviceSession({ ...base, userAgent }, 'other')).toMatchObject({ browser, platform, appType: 'web', isCurrent: false })
  })
  it('corrects legacy Windows desktop labels using the user agent', () => {
    const value = serializeDeviceSession({ ...base, deviceLabel: 'Pulpo for Mac', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Electron/33.0.0 Safari/537.36' }, '')
    expect(value).toMatchObject({ appType: 'desktop', platform: 'windows', deviceLabel: 'Pulpo for Windows', browser: null })
  })
  it.each(['ios', 'android', 'macos', 'windows', 'linux'])('uses explicit platform %s for native sessions', (platform) => {
    expect(serializeDeviceSession({ ...base, deviceLabel: 'My device', appType: 'mobile', platform }, '')).toMatchObject({ deviceLabel: 'My device', platform, appType: 'mobile', browser: null })
  })
  it('recognizes CLI labels and leaves ambiguous device labels unknown', () => {
    expect(serializeDeviceSession({ ...base, deviceLabel: 'Pulpo CLI' }, '').appType).toBe('cli')
    expect(serializeDeviceSession({ ...base, deviceLabel: 'My computer' }, '').appType).toBe('unknown')
  })
})
