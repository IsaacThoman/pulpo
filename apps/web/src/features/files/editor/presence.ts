import { uit } from '@/i18n/ui'
import { desktopDevice, isDesktopRuntime } from '@/lib/runtime'

export { sessionColor } from '@pulpo/client-core/doc-sync'

/** Names the device behind a cursor, since every session belongs to the same person today. */
export function sessionLabel(userAgent = navigator.userAgent): string {
  if (isDesktopRuntime()) return desktopDevice().deviceLabel
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\//.test(userAgent) ? 'Firefox'
      : /Chrome\//.test(userAgent) ? 'Chrome'
        : /Safari\//.test(userAgent) ? 'Safari'
          : 'Browser'
  const os = /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
      : /Mac OS X/.test(userAgent) ? 'macOS'
        : /Windows/.test(userAgent) ? 'Windows'
          : /Linux/.test(userAgent) ? 'Linux'
            : ''
  return os ? uit`${browser} on ${os}` : browser
}
