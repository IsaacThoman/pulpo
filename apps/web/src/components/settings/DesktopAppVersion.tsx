import { useEffect, useState } from 'react'
import { ui } from '@/i18n/ui'

export function DesktopAppVersion() {
  const [version, setVersion] = useState<string | null>(null)
  const appInfo = window.pulpoDesktop?.appInfo

  useEffect(() => {
    if (!appInfo) return
    let active = true
    void appInfo()
      .then((info) => {
        if (active) setVersion(info.version)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [appInfo])

  if (!appInfo) return null
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{ui('App version')}</span>
      <span className="font-mono">{version ?? ui('Loading…')}</span>
    </div>
  )
}
