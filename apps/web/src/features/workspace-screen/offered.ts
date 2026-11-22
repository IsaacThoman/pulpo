import { useSyncExternalStore } from 'react'
import { adminChatAccessActive, subscribeAdminChatGrant } from '@/features/admin-chat/access'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'

/** The workspace's screen is offered to the signed-in owner of a chat, when the instance gives workspaces one. */
export function useWorkspaceScreenOffered(): boolean {
  const workspaceScreen = useCatalog((state) => state.workspaceScreen)
  const adminAccess = useSyncExternalStore(subscribeAdminChatGrant, adminChatAccessActive, adminChatAccessActive)
  const signedIn = useAuth((state) => Boolean(state.user?.id))
  return workspaceScreen && signedIn && !adminAccess
}
