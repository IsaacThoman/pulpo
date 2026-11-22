// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_STORE_URL, GITHUB_LATEST_RELEASE_URL } from '@/lib/links'
import { AppDownloads } from './AppDownloads'

const ASSETS = [
  'Pulpo-0.181.0-Android.apk',
  'Pulpo-0.181.0-macOS-arm64.dmg',
  'Pulpo-0.181.0-macOS-x64.dmg',
  'Pulpo-0.181.0-Windows-arm64-Setup.exe',
  'Pulpo-0.181.0-Windows-x64-Setup.exe',
]

function stubLatestRelease(response: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AppDownloads', () => {
  it('links each platform to its installer in the latest release', async () => {
    stubLatestRelease({
      ok: true,
      json: async () => ({ tag_name: 'v0.181.0', assets: ASSETS.map((name) => ({ name, browser_download_url: `https://example.test/${name}` })) }),
    })

    render(<AppDownloads />)

    await waitFor(() => expect(href('Download APK')).toBe('https://example.test/Pulpo-0.181.0-Android.apk'))
    expect(href('App Store')).toBe(APP_STORE_URL)
    expect(href('Download for macOS (Apple silicon)')).toBe('https://example.test/Pulpo-0.181.0-macOS-arm64.dmg')
    expect(href('Download for macOS (Intel)')).toBe('https://example.test/Pulpo-0.181.0-macOS-x64.dmg')
    expect(href('Download for Windows (x64)')).toBe('https://example.test/Pulpo-0.181.0-Windows-x64-Setup.exe')
    expect(href('Download for Windows (ARM64)')).toBe('https://example.test/Pulpo-0.181.0-Windows-arm64-Setup.exe')
  })

  it('falls back to the releases page when GitHub does not answer', async () => {
    stubLatestRelease({ ok: false })

    render(<AppDownloads />)

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(href('App Store')).toBe(APP_STORE_URL)
    for (const name of ['Download APK', 'Download for macOS (Apple silicon)', 'Download for macOS (Intel)', 'Download for Windows (x64)', 'Download for Windows (ARM64)']) {
      expect(href(name)).toBe(GITHUB_LATEST_RELEASE_URL)
    }
  })
})
