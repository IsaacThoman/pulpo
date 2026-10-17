import type { TrashRetention } from '@pulpo/contracts'
import { ui, uit } from '@/i18n/ui'

export function trashRetentionLabel(retention: TrashRetention): string {
  switch (retention) {
    case 'instant': return ui("No retention")
    case '24h': return ui("24 hours")
    case '7d': return ui("7 days")
    case '30d': return ui("30 days")
    case '90d': return ui("90 days")
    case 'indefinite': return ui("Indefinitely")
  }
}

/** When a trashed item is deleted for good, relative to `now`. */
export function trashDeletesLabel(purgeAt: string | null, now = Date.now()): string {
  if (!purgeAt) return ui("Kept indefinitely")
  const ms = Date.parse(purgeAt) - now
  if (ms <= 0) return ui("Deletes now")
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return uit`Deletes in ${minutes}m`
  const hours = Math.ceil(ms / 3_600_000)
  if (hours < 24) return uit`Deletes in ${hours}h`
  return uit`Deletes in ${Math.ceil(ms / 86_400_000)}d`
}

/** What the retention setting means for each kind of item, for the trash page and Settings. */
export function trashRetentionSummary(retention: TrashRetention, files: boolean): string {
  if (retention === 'instant') {
    return files
      ? ui("Chats are deleted right away. Files stay in the trash for 24 hours.")
      : ui("Chats are deleted right away. Folders stay in the trash for 24 hours.")
  }
  if (retention === 'indefinite') return ui("Items stay in the trash until you delete them.")
  return uit`Items are deleted forever after ${trashRetentionLabel(retention).toLowerCase()}.`
}
