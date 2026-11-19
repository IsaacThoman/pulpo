import type { FileAccessMode } from '@pulpo/contracts'
import { Eye, MessageSquareDiff, PencilLine, type LucideIcon } from 'lucide-react'
import { ui } from '@/i18n/ui'

export const ACCESS_ICONS: Record<FileAccessMode, LucideIcon> = { read: Eye, suggest: MessageSquareDiff, write: PencilLine }

export function accessModeLabel(mode: FileAccessMode): string {
  switch (mode) {
    case 'read': return ui("Read only")
    case 'suggest': return ui("Suggest changes")
    case 'write': return ui("Edit directly")
  }
}
