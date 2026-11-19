import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { isComputerFolderMode, type ComputerAccess, type ComputerFolder } from '@pulpo/contracts'
import type { AgentComputerControls } from '@/components/chat/AgentMenu'
import { adminChatAccessActive, subscribeAdminChatGrant } from '@/features/admin-chat/access'
import { useFileToasts } from '@/features/files/browser/toasts'
import { desktopComputerApi, runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { chooseComputer, keepComputerChoice, useComputerChoice, type ComputerChoice } from './selection'
import { prepareComputerSend, type ComputerSendPreparation } from './sessions'

const NOT_USED: ComputerSendPreparation = { ok: true, selection: undefined }
/** How many already-allowed folders the menu offers besides the chosen one. */
const RECENT_FOLDERS = 4

/**
 * This computer in a composer: whether it is offered (the desktop app has the bridge, the instance
 * allows it, and this is the user's own chat rather than admin access), the chat's choice, the
 * Workspace menu's actions, and registering a session before a message is sent.
 */
export function useComputerControls({ chatId, onEnable }: {
  chatId: string | null
  /** Choosing This computer also turns the agent on. */
  onEnable?: () => void
}) {
  const api = desktopComputerApi()
  const computerAccess = useCatalog((state) => state.computerAccess)
  const adminAccess = useSyncExternalStore(subscribeAdminChatGrant, adminChatAccessActive)
  const userId = useAuth((state) => state.user?.id)
  const owner = api && computerAccess && !adminAccess && userId ? runtimeAccountKey(userId) : null
  const choice = useComputerChoice(owner, chatId)
  // Folders the user allowed before can be chosen again without the folder dialog.
  const [allowedFolders, setAllowedFolders] = useState<ComputerFolder[]>([])
  const refreshAllowedFolders = useCallback(() => {
    if (!api || !owner) { setAllowedFolders([]); return }
    void api.status().then((status) => setAllowedFolders(status.folders)).catch(() => undefined)
  }, [api, owner])
  useEffect(refreshAllowedFolders, [refreshAllowedFolders])

  const set = (next: ComputerChoice) => { if (owner) chooseComputer(owner, chatId, next) }
  const pickFolder = async (): Promise<ComputerFolder | null> => {
    try {
      const folder = await api?.chooseFolder() ?? null
      if (folder) refreshAllowedFolders()
      return folder
    } catch { return null }
  }
  const selectAccess = async (access: ComputerAccess) => {
    if (!api) return
    let folder = choice.folder
    if (access === 'full') {
      let allowed = false
      try { allowed = await api.allowFullAccess() } catch { /* treated as declined */ }
      if (!allowed) return
    } else if (isComputerFolderMode(access) && !folder) {
      folder = await pickFolder()
      if (!folder) return
    }
    set({ enabled: true, access, folder })
    onEnable?.()
  }

  const controls: AgentComputerControls | undefined = owner ? {
    active: choice.enabled,
    access: choice.access,
    folder: choice.folder,
    recentFolders: allowedFolders.filter((folder) => folder.path !== choice.folder?.path).slice(0, RECENT_FOLDERS),
    // The folder and access stay for the next time This computer is chosen.
    onCloud: () => set({ ...choice, enabled: false }),
    onAccess: (access) => { void selectAccess(access) },
    onChooseFolder: () => { void pickFolder().then((folder) => { if (folder) set({ ...choice, folder }) }) },
    onFolder: (folder) => set({ ...choice, folder }),
  } : undefined

  return {
    controls,
    /** Messages sent with the agent will use this computer. */
    active: Boolean(owner && choice.enabled),
    /**
     * Registers a session for one message with the desktop app. When that fails the user sees why
     * in a toast and the message must not be sent.
     */
    prepare: async (agentMode: boolean): Promise<ComputerSendPreparation> => {
      if (!owner || !agentMode || !choice.enabled) return NOT_USED
      const prepared = await prepareComputerSend(choice)
      if (!prepared.ok) useFileToasts.getState().show({ message: prepared.message, tone: 'error' })
      else if (prepared.folder) set({ ...choice, folder: prepared.folder })
      return prepared
    },
    /** A chat that was sent a message keeps the choice it was sent with. */
    keepFor: (targetChatId: string) => { if (owner) keepComputerChoice(owner, targetChatId, choice) },
  }
}
