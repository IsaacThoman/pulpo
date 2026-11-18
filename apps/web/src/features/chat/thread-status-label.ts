import type { ChatThreadStatus } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

/** A thread's status in words, as the threads list groups it. */
export function threadStatusLabel(status: ChatThreadStatus): string {
  switch (status) {
    case 'working': return ui('Working')
    case 'attention': return ui('Needs attention')
    case 'done': return ui('Done')
    case 'resolved': return ui('Resolved')
  }
}
