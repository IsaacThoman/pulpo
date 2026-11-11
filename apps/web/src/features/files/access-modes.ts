import type { FileAccessMode } from '@pulpo/contracts'
import { Eye, MessageSquareDiff, PencilLine, type LucideIcon } from 'lucide-react'
import { ui } from '@/i18n/ui'

export const ACCESS_ICONS: Record<FileAccessMode, LucideIcon> = { read: Eye, suggest: MessageSquareDiff, write: PencilLine }

/** How each mode reads where it is chosen. */
export function accessModeCopy(mode: FileAccessMode): { label: string; description: string } {
  switch (mode) {
    case 'read': return { label: ui("Read only"), description: ui("The agent can look but not change anything") }
    case 'suggest': return { label: ui("Suggest changes"), description: ui("You accept or reject each change") }
    case 'write': return { label: ui("Edit directly"), description: ui("Changes apply right away, and you can undo them") }
  }
}
