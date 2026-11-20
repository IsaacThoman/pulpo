import { useSyncExternalStore } from 'react'
import { isAppTool } from '@/components/chat/tool-activity-presentation'
import { adminChatAccessActive, subscribeAdminChatGrant } from '@/features/admin-chat/access'
import type { Message } from '@/lib/types'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'

/** The workspace's screen is offered to the signed-in owner of a chat, when the instance gives workspaces one. */
export function useWorkspaceScreenOffered(): boolean {
  const workspaceScreen = useCatalog((state) => state.workspaceScreen)
  const adminAccess = useSyncExternalStore(subscribeAdminChatGrant, adminChatAccessActive, adminChatAccessActive)
  const signedIn = useAuth((state) => Boolean(state.user?.id))
  return workspaceScreen && signedIn && !adminAccess
}

type Item = { type?: unknown; computer?: unknown; tool?: unknown }

const usedScreen = new WeakMap<Message, boolean>()

/**
 * A reply that used the app tools in a cloud workspace, so on the workspace's screen. A reply on
 * the user's own computer never counts: that screen is theirs.
 */
export function usesWorkspaceScreen(message: Message): boolean {
  if (message.role !== 'assistant') return false
  let used = usedScreen.get(message)
  if (used === undefined) {
    const items = (message.outputItems ?? []) as Item[]
    used = items.some((item) => item?.type === 'pulpo_workspace' && !item.computer)
      && items.some((item) => item?.type === 'pulpo_tool' && typeof item.tool === 'string' && isAppTool(item.tool))
    usedScreen.set(message, used)
  }
  return used
}

/** The newest reply in the chat that used the workspace's screen: the only one that offers it. */
export function newestScreenReplyId(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (usesWorkspaceScreen(messages[index]!)) return messages[index]!.id
  }
  return undefined
}
