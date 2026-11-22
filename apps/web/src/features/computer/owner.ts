import { adminChatAccessActive } from '@/features/admin-chat/access'
import { desktopComputerApi, runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { computerChoice, type ComputerChoice } from './selection'

/**
 * Whose computer choices apply right now, or null where This computer is not offered: no desktop
 * bridge, the instance has it off, admin access to someone else's chat, or nobody signed in.
 */
export function computerOwner(): string | null {
  const userId = useAuth.getState().user?.id
  return desktopComputerApi() && useCatalog.getState().computerAccess && !adminChatAccessActive() && userId
    ? runtimeAccountKey(userId)
    : null
}

/** The choice a reply made outside the composer (a regeneration) uses for this chat, when This computer is on. */
export function activeComputerChoice(chatId: string): ComputerChoice | null {
  const owner = computerOwner()
  const choice = owner ? computerChoice(owner, chatId) : null
  return choice?.enabled ? choice : null
}
