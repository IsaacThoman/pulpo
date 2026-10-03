import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ os: 'ios', nativeVersion: '1.4.2' as string | null, configVersion: '1.0.0' as string | undefined }))
vi.mock('react-native', () => ({ Platform: { get OS() { return mocks.os } } }))
vi.mock('expo-application', () => ({ get nativeApplicationVersion() { return mocks.nativeVersion } }))
vi.mock('expo-constants', () => ({ default: { get expoConfig() { return { version: mocks.configVersion } } } }))

const { mobileClientPlatform } = await import('./clientPlatform')

describe('mobile client platform', () => {
  beforeEach(() => { mocks.os = 'ios'; mocks.nativeVersion = '1.4.2'; mocks.configVersion = '1.0.0' })
  it('uses the installed native app version', () => {
    expect(mobileClientPlatform()).toBe('ios/1.4.2')
    mocks.os = 'android'
    expect(mobileClientPlatform()).toBe('android/1.4.2')
  })
  it('falls back to the Expo config version, then the bare platform', () => {
    mocks.nativeVersion = null
    expect(mobileClientPlatform()).toBe('ios/1.0.0')
    mocks.configVersion = 'not a version!'
    expect(mobileClientPlatform()).toBe('ios')
  })
  it('sends nothing on other platforms', () => {
    mocks.os = 'web'
    expect(mobileClientPlatform()).toBeNull()
  })
})
