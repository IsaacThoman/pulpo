import { DEFAULT_FILE_ACCESS_MODE, FILE_ACCESS_MODES, FILE_SCOPE_ROOT, type FileAccessMode } from '@pulpo/contracts'
import { useCallback } from 'react'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useFilesEnabled } from './availability'

export { FILE_ACCESS_MODES, FILE_SCOPE_ROOT }

const NO_IDS: string[] = []

export interface ChatFilesAccess {
  /** Whether this chat can take Files at all: Files on, not a temporary chat. */
  available: boolean
  /** A saved chat (one with Files access to show), rather than the one not sent yet. */
  saved: boolean
  /** What the agent may change in Files: the chat's own choice, or new chats' for the unsent one. */
  changeMode: FileAccessMode
  setChangeMode: (mode: FileAccessMode) => void
  /** Items the chat's messages mentioned (`root` is all of My files, from older clients). */
  itemIds: string[]
  removeItem: (id: string) => void
  /** The user let the agent look through all of their Files in this chat. */
  browseAllowed: boolean
  revokeBrowse: () => void
  /** Off when the account lets the agent look through Files without asking. */
  askBeforeBrowsing: boolean
}

/**
 * What a chat's agent may do with Files, as the Agent menu shows it: in a saved chat, the chat's
 * own settings (saved on the server, queued while offline); in the unsent chat, the account's
 * choice for new chats, which the server starts the chat with.
 */
export function useChatFilesAccess(chatId: string | null | undefined, temporary: boolean): ChatFilesAccess {
  const filesEnabled = useFilesEnabled()
  const chat = usePrototypeStore((state) => chatId ? state.chats.find((candidate) => candidate.id === chatId) : undefined)
  const preferredMode = usePrototypeStore((state) => state.preferences.agentFileChangeMode)
  const askBeforeBrowsing = usePrototypeStore((state) => state.preferences.agentFilesAskBeforeBrowsing)
  const itemIds = chat?.fileScopeIds ?? NO_IDS
  const setChangeMode = useCallback((mode: FileAccessMode) => {
    const store = usePrototypeStore.getState()
    if (chatId) store.setChatFileChangeMode(chatId, mode)
    else store.setPreference('agentFileChangeMode', mode)
  }, [chatId])
  const removeItem = useCallback((id: string) => {
    if (chatId) usePrototypeStore.getState().setChatFileScope(chatId, itemIds.filter((item) => item !== id))
  }, [chatId, itemIds])
  const revokeBrowse = useCallback(() => {
    if (chatId) usePrototypeStore.getState().revokeChatFilesBrowse(chatId)
  }, [chatId])
  return {
    available: filesEnabled && !temporary && !chat?.temporary,
    saved: Boolean(chat),
    // A chat just started takes the account's choice until the server's copy arrives.
    changeMode: chat?.fileChangeMode ?? preferredMode ?? DEFAULT_FILE_ACCESS_MODE,
    setChangeMode,
    itemIds,
    removeItem,
    browseAllowed: chat?.filesBrowseAllowed ?? false,
    revokeBrowse,
    askBeforeBrowsing,
  }
}

/** The Agent menu's "Changes to Files" choices. */
export const FILE_CHANGE_MODE_LABELS: Record<FileAccessMode, { title: string; detail: string; symbol: string }> = {
  read: { title: 'Read only', detail: 'Read Files without changing them', symbol: 'eye' },
  suggest: { title: 'Suggest changes', detail: 'Suggest changes for you to review', symbol: 'text.badge.checkmark' },
  write: { title: 'Edit directly', detail: 'Change Files directly (undo from the reply)', symbol: 'pencil' },
}
