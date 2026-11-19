import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { isComputerFolderMode, type ComputerAccess, type ComputerFolder } from '@pulpo/contracts'
import type { AgentComputerControls } from '@/components/chat/AgentMenu'
import { adminChatAccessActive, subscribeAdminChatGrant } from '@/features/admin-chat/access'
import { useFileToasts } from '@/features/files/browser/toasts'
import { ui } from '@/i18n/ui'
import { desktopComputerApi, runtimeAccountKey } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { chooseComputer, computerChoice, keepComputerChoice, useComputerChoice, type ComputerChoice } from './selection'
import { prepareComputerSend, type ComputerSendPreparation } from './sessions'

const NOT_USED: ComputerSendPreparation = { ok: true, selection: undefined }
/** How many already-allowed folders the menu offers besides the chosen one. */
const RECENT_FOLDERS = 4

/**
 * This computer in a composer: whether it is offered (the desktop app has the bridge, the instance
 * allows it, and this is the user's own chat rather than admin access), the chat's choice, the
 * menu's actions, and registering a session before a message is sent.
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

  // An action waits on a native dialog, and the choice may change meanwhile, so each one starts
  // from the choice as it stands when it is applied rather than as it was when the menu rendered.
  const change = (apply: (current: ComputerChoice) => ComputerChoice) => {
    if (owner) chooseComputer(owner, chatId, apply(computerChoice(owner, chatId)))
  }
  /**
   * A dialog that comes back empty was either cancelled, which needs no words, or never shown
   * because the app could not tell who is signed in. Only the app knows which, so it is asked.
   */
  const explainIfUnavailable = async () => {
    let available = true
    try { available = (await api?.status())?.signedIn !== false } catch { available = false }
    if (!available) useFileToasts.getState().show({ message: ui("Can't use this computer right now. Check your connection and try again."), tone: 'error' })
  }
  const pickFolder = async (): Promise<ComputerFolder | null> => {
    let folder: ComputerFolder | null = null
    try { folder = await api?.chooseFolder() ?? null } catch { /* told below */ }
    if (folder) refreshAllowedFolders()
    else await explainIfUnavailable()
    return folder
  }
  const selectAccess = async (access: ComputerAccess) => {
    if (!api || !owner) return
    if (access === 'full') {
      let allowed = false
      try { allowed = await api.allowFullAccess() } catch { /* told below */ }
      if (!allowed) { await explainIfUnavailable(); return }
      change((current) => ({ ...current, enabled: true, access }))
    } else if (isComputerFolderMode(access)) {
      // These modes work in one folder, so the first use asks for it.
      const folder = computerChoice(owner, chatId).folder ?? await pickFolder()
      if (!folder) return
      change(() => ({ enabled: true, access, folder }))
    }
    onEnable?.()
  }

  const controls: AgentComputerControls | undefined = owner ? {
    active: choice.enabled,
    access: choice.access,
    folder: choice.folder,
    recentFolders: allowedFolders.filter((folder) => folder.path !== choice.folder?.path).slice(0, RECENT_FOLDERS),
    // The access and folder stay for the next time This computer is turned on.
    onOff: () => change((current) => ({ ...current, enabled: false })),
    onAccess: (access) => { void selectAccess(access) },
    onChooseFolder: () => { void pickFolder().then((folder) => { if (folder) change((current) => ({ ...current, folder })) }) },
    // Only full access works without a folder.
    onFolder: (folder) => change((current) => folder || current.access === 'full' ? { ...current, folder } : current),
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
      else if (prepared.folder) {
        const folder = prepared.folder
        change((current) => ({ ...current, folder }))
      }
      return prepared
    },
    /** A chat that was sent a message keeps the choice it was sent with. */
    keepFor: (targetChatId: string) => { if (owner) keepComputerChoice(owner, targetChatId, choice) },
  }
}
