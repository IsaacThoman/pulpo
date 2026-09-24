import { useEffect, useState } from 'react'
import { APP_STORE_URL, GITHUB_LATEST_RELEASE_API, GITHUB_LATEST_RELEASE_URL } from '@/lib/links'

export type DownloadPlatform = 'macos-arm64' | 'macos-x64' | 'windows-x64' | 'windows-arm64' | 'android' | 'ios'

export const DOWNLOAD_PLATFORMS: DownloadPlatform[] = ['macos-arm64', 'macos-x64', 'windows-x64', 'windows-arm64', 'android', 'ios']

// Matches the versioned asset names the release workflow publishes, e.g. Pulpo-0.144.1-macOS-arm64.dmg.
const ASSET_PATTERNS: Record<Exclude<DownloadPlatform, 'ios'>, RegExp> = {
  'macos-arm64': /-macOS-arm64\.dmg$/,
  'macos-x64': /-macOS-x64\.dmg$/,
  'windows-x64': /-Windows-x64-Setup\.exe$/,
  'windows-arm64': /-Windows-arm64-Setup\.exe$/,
  android: /-Android\.apk$/,
}

export type LatestRelease = { version: string; assets: Array<{ name: string; url: string }> }

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } }

/** Best guess from the user agent. Browsers hide Mac CPU architecture, so Macs default to Apple silicon. Returns null outside a browser, including the build's pre-render. */
export function detectPlatform(nav: NavigatorWithUAData | undefined = typeof window === 'undefined' ? undefined : navigator): DownloadPlatform | null {
  if (!nav) return null
  const userAgent = nav.userAgent ?? ''
  const platform = nav.userAgentData?.platform ?? nav.platform ?? ''
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Mac/.test(platform) && nav.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  if (/Mac/.test(platform) || /Macintosh/.test(userAgent)) return 'macos-arm64'
  if (/Win/.test(platform) || /Windows/.test(userAgent)) return /ARM64|aarch64/i.test(userAgent) ? 'windows-arm64' : 'windows-x64'
  return null
}

/** Direct download link for a platform, falling back to the releases page until the latest release is known. */
export function downloadUrl(platform: DownloadPlatform, release: LatestRelease | null): string {
  if (platform === 'ios') return APP_STORE_URL
  const asset = release?.assets.find((candidate) => ASSET_PATTERNS[platform].test(candidate.name))
  return asset?.url ?? GITHUB_LATEST_RELEASE_URL
}

export function parseLatestRelease(value: unknown): LatestRelease | null {
  if (!value || typeof value !== 'object') return null
  const { tag_name: tag, assets } = value as { tag_name?: unknown; assets?: unknown }
  if (typeof tag !== 'string' || !Array.isArray(assets)) return null
  return {
    version: tag.replace(/^v/, ''),
    assets: assets.flatMap((asset) => {
      const { name, browser_download_url: url } = (asset ?? {}) as { name?: unknown; browser_download_url?: unknown }
      return typeof name === 'string' && typeof url === 'string' ? [{ name, url }] : []
    }),
  }
}

export function useLatestRelease(): LatestRelease | null {
  const [release, setRelease] = useState<LatestRelease | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(GITHUB_LATEST_RELEASE_API, { signal: controller.signal, headers: { accept: 'application/vnd.github+json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setRelease(parseLatestRelease(body)))
      // Links keep pointing at the releases page when GitHub is unreachable or rate limited.
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return release
}
