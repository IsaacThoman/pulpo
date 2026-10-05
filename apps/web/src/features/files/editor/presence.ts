import { uit } from '@/i18n/ui'
import { desktopDevice, isDesktopRuntime } from '@/lib/runtime'

/** Distinct, readable on light and dark backgrounds. */
const SESSION_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d']

export function sessionColor(clientId: number): string {
  return SESSION_COLORS[clientId % SESSION_COLORS.length]!
}

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
