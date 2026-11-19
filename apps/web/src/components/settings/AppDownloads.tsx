import { useId } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui, uit } from '@/i18n/ui'
import { downloadUrl, useLatestRelease, type DownloadPlatform } from '@/lib/downloads'

// Desktop builds come per processor, and a browser can't tell which one a Mac has, so both are offered.
const DESKTOP_APPS: Array<{ name: string; builds: Array<{ platform: DownloadPlatform; label: string }> }> = [
  { name: 'macOS', builds: [{ platform: 'macos-arm64', label: 'Apple silicon' }, { platform: 'macos-x64', label: 'Intel' }] },
  { name: 'Windows', builds: [{ platform: 'windows-x64', label: 'x64' }, { platform: 'windows-arm64', label: 'ARM64' }] },
]

function AppRow({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-4">
      <span className="text-muted-foreground">{name}</span>
      <span className="flex shrink-0 gap-2">{children}</span>
    </li>
  )
}

/** Where to get Pulpo for each platform. Links go straight to the latest release's installers once GitHub answers, and to the releases page until then. */
export function AppDownloads() {
  const headingId = useId()
  const release = useLatestRelease()
  const link = (platform: DownloadPlatform) => ({ href: downloadUrl(platform, release), target: '_blank', rel: 'noreferrer' })

  return (
    <section aria-labelledby={headingId} className="py-3 text-sm">
      <h3 id={headingId} className="font-medium">{ui("Get the apps")}</h3>
      <ul className="mt-3 space-y-2">
        <AppRow name={ui("iPhone and iPad")}>
          <Button asChild variant="outline" size="sm"><a {...link('ios')}><ExternalLink aria-hidden />{ui("App Store")}</a></Button>
        </AppRow>
        <AppRow name={ui("Android")}>
          <Button asChild variant="outline" size="sm"><a {...link('android')}><Download aria-hidden />{ui("Download APK")}</a></Button>
        </AppRow>
        {DESKTOP_APPS.map((app) => (
          <AppRow key={app.name} name={app.name}>
            {app.builds.map((build) => {
              const target = `${app.name} (${build.label})`
              return (
                <Button key={build.platform} asChild variant="outline" size="sm">
                  <a {...link(build.platform)} aria-label={uit`Download for ${target}`}><Download aria-hidden />{build.label}</a>
                </Button>
              )
            })}
          </AppRow>
        ))}
      </ul>
    </section>
  )
}
