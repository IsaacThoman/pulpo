import { friendRequestAge as sharedFriendRequestAge } from '@pulpo/client-core'
import { activeLocale } from '@/i18n/ui'

export function friendRequestAge(isoDate: string, now = Date.now()): string {
  return sharedFriendRequestAge(isoDate, now, activeLocale())
}
