import { describe, expect, it } from 'vitest'
import { detectPlatform, downloadUrl, parseLatestRelease } from './downloads'
import { APP_STORE_URL, GITHUB_LATEST_RELEASE_URL } from './links'

function nav(userAgent: string, platform = '', maxTouchPoints = 0) {
  return { userAgent, platform, maxTouchPoints } as unknown as Navigator
}

const release = parseLatestRelease({
  tag_name: 'v0.144.1',
  assets: [
    'Pulpo-0.144.1-Android.apk',
    'Pulpo-0.144.1-Android.apk.sha256',
    'Pulpo-0.144.1-macOS-arm64.dmg',
    'Pulpo-0.144.1-macOS-x64.dmg',
    'Pulpo-0.144.1-Windows-arm64-Setup.exe',
    'Pulpo-0.144.1-Windows-x64-Setup.exe',
    'Pulpo-win32-arm64-Setup.exe',
    'Setup.exe',
  ].map((name) => ({ name, browser_download_url: `https://example.test/${name}` })),
})

describe('detectPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'MacIntel', 0, 'macos-arm64'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 5, 'ios'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 'iPhone', 5, 'ios'],
    ['Mozilla/5.0 (Linux; Android 16; Pixel 10)', 'Linux armv81', 5, 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, 'windows-x64'],
    ['Mozilla/5.0 (Windows NT 10.0; ARM64)', 'Win32', 0, 'windows-arm64'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0, null],
  ] as const)('maps %s to %s', (userAgent, platform, touchPoints, expected) => {
    expect(detectPlatform(nav(userAgent, platform, touchPoints))).toBe(expected)
  })
})

describe('downloadUrl', () => {
  it('picks the versioned installer for each platform', () => {
    expect(release?.version).toBe('0.144.1')
    expect(downloadUrl('macos-arm64', release)).toBe('https://example.test/Pulpo-0.144.1-macOS-arm64.dmg')
    expect(downloadUrl('macos-x64', release)).toBe('https://example.test/Pulpo-0.144.1-macOS-x64.dmg')
    expect(downloadUrl('windows-x64', release)).toBe('https://example.test/Pulpo-0.144.1-Windows-x64-Setup.exe')
    expect(downloadUrl('windows-arm64', release)).toBe('https://example.test/Pulpo-0.144.1-Windows-arm64-Setup.exe')
    expect(downloadUrl('android', release)).toBe('https://example.test/Pulpo-0.144.1-Android.apk')
  })

  it('sends iOS to the App Store and falls back to the releases page', () => {
    expect(downloadUrl('ios', release)).toBe(APP_STORE_URL)
    expect(downloadUrl('macos-arm64', null)).toBe(GITHUB_LATEST_RELEASE_URL)
    expect(downloadUrl('android', parseLatestRelease({ tag_name: 'v1.0.0', assets: [] }))).toBe(GITHUB_LATEST_RELEASE_URL)
  })

  it('ignores malformed release payloads', () => {
    expect(parseLatestRelease({ message: 'API rate limit exceeded' })).toBeNull()
    expect(parseLatestRelease(null)).toBeNull()
  })
})
