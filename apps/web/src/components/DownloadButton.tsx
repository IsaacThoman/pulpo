import { useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui, uit } from '@/i18n/ui'
import { DOWNLOAD_PLATFORMS, detectPlatform, downloadUrl, useLatestRelease, type DownloadPlatform } from '@/lib/downloads'
import { GITHUB_LATEST_RELEASE_URL } from '@/lib/links'

const PLATFORM_NAMES: Record<DownloadPlatform, string> = {
  'macos-arm64': 'macOS',
  'macos-x64': 'macOS',
  'windows-x64': 'Windows',
  'windows-arm64': 'Windows',
  android: 'Android',
  ios: 'iOS',
}

function platformLabel(platform: DownloadPlatform): string {
  switch (platform) {
    case 'macos-arm64': return ui("macOS (Apple silicon)")
    case 'macos-x64': return ui("macOS (Intel)")
    case 'windows-x64': return ui("Windows (x64)")
    case 'windows-arm64': return ui("Windows (ARM)")
    case 'android': return ui("Android (APK)")
    case 'ios': return ui("iOS (App Store)")
  }
}

/** Downloads the latest release for the visitor's platform, with every other platform in a menu. */
export function DownloadButton() {
  const [platform] = useState(() => detectPlatform())
  const release = useLatestRelease()

  const menu = (
    <DropdownMenuContent align="end" className="w-52">
      {DOWNLOAD_PLATFORMS.map((option) => (
        <DropdownMenuItem key={option} asChild>
          <a href={downloadUrl(option, release)}>{platformLabel(option)}</a>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <a href={GITHUB_LATEST_RELEASE_URL}>{ui("All releases")}</a>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  if (!platform) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="lg"><Download />{ui("Download")}<ChevronDown /></Button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    )
  }

  return (
    <div className="inline-flex">
      <Button asChild size="lg" className="rounded-r-none">
        <a href={downloadUrl(platform, release)}><Download />{uit`Download for ${PLATFORM_NAMES[platform]}`}</a>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="lg" className="rounded-l-none border-l border-primary-foreground/20 px-2.5" aria-label={ui("Other platforms")}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    </div>
  )
}
