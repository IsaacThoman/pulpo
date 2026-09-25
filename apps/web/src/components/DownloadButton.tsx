import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui, uit } from '@/i18n/ui'
import { detectPlatform, downloadUrl, useLatestRelease, type DownloadPlatform } from '@/lib/downloads'
import { GITHUB_LATEST_RELEASE_URL } from '@/lib/links'

const PLATFORM_NAMES: Record<DownloadPlatform, string> = {
  'macos-arm64': 'macOS',
  'macos-x64': 'macOS',
  'windows-x64': 'Windows',
  'windows-arm64': 'Windows',
  android: 'Android',
  ios: 'iOS',
}

/** Downloads the latest release for the visitor's platform, or opens the releases page when it is unknown. */
export function DownloadButton() {
  const [platform] = useState(() => detectPlatform())
  const release = useLatestRelease()

  return (
    <Button asChild size="lg">
      {platform
        ? <a href={downloadUrl(platform, release)}><Download />{uit`Download for ${PLATFORM_NAMES[platform]}`}</a>
        : <a href={GITHUB_LATEST_RELEASE_URL}><Download />{ui("Download")}</a>}
    </Button>
  )
}
