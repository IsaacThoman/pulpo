import { DEFAULT_FILE_ACCESS_MODE, FILE_SCOPE_ROOT, MAX_CHAT_FILE_SCOPES, type FileAccessMode } from '@pulpo/contracts'
import { addFileScope, scopedFileAccess } from '@pulpo/client-core/files'
import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { getValue, setValue } from '../../data/database'
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore'
import { useFilesEnabled } from './availability'

export { FILE_SCOPE_ROOT, MAX_CHAT_FILE_SCOPES }

export interface FileScopeState {
  ids: string[]
  access: Partial<Record<string, FileAccessMode>>
}

const EMPTY: FileScopeState = { ids: [], access: {} }
const STORAGE_KEY = 'files:new-chat-scope'

/**
 * The Files items picked for the chat not sent yet, per account. Kept on the device so a draft's
 * scope survives relaunching; sent with the chat when it starts, then cleared.
 */
export const useNewChatFileScope = create<{
  scopes: Record<string, FileScopeState>
  loaded: Record<string, true>
  load: (namespace: string) => void
  set: (namespace: string, scope: FileScopeState) => void
}>((set, get) => ({
  scopes: {},
  loaded: {},
  load: (namespace) => {
    if (get().loaded[namespace]) return
    set((state) => ({ loaded: { ...state.loaded, [namespace]: true } }))
    void getValue<FileScopeState>(namespace, STORAGE_KEY).then((stored) => {
      // A scope picked meanwhile wins over the stored one.
      if (stored && !get().scopes[namespace]) set((state) => ({ scopes: { ...state.scopes, [namespace]: stored } }))
    }).catch(() => undefined)
  },
  set: (namespace, scope) => {
    set((state) => ({ scopes: { ...state.scopes, [namespace]: scope } }))
    void setValue(namespace, STORAGE_KEY, scope).catch(() => undefined)
  },
}))

/** The unsent chat's scope, for starting it; empty when there is none. */
export function newChatFileScope(namespace: string): FileScopeState {
  return useNewChatFileScope.getState().scopes[namespace] ?? EMPTY
}

export function clearNewChatFileScope(namespace: string): void {
  useNewChatFileScope.getState().set(namespace, EMPTY)
}

export interface ChatFileScope extends FileScopeState {
  /** Whether this chat can take Files at all: Files on, not a temporary chat. */
  available: boolean
  /** Adds items once each; returns how many could not be added for the limit. */
  add: (ids: string[]) => number
  remove: (id: string) => void
  setAccess: (id: string, mode: FileAccessMode) => void
  accessOf: (id: string) => FileAccessMode
}

/**
 * The Files items a chat's agent works with, as the composer edits them: a saved chat's own scope
 * (saved on the server, queued while offline), or the unsent chat's draft scope.
 */
export function useChatFileScope(namespace: string, chatId: string | null | undefined, temporary: boolean): ChatFileScope {
  const filesEnabled = useFilesEnabled()
  const savedIds = usePrototypeStore((state) => chatId ? state.chats.find((chat) => chat.id === chatId)?.fileScopeIds : undefined)
  const savedAccess = usePrototypeStore((state) => chatId ? state.chats.find((chat) => chat.id === chatId)?.fileScopeAccess : undefined)
  const draft = useNewChatFileScope((state) => state.scopes[namespace])
  const load = useNewChatFileScope((state) => state.load)
  useEffect(() => { if (namespace && !chatId) load(namespace) }, [chatId, load, namespace])
  const scope: FileScopeState = useMemo(() => chatId
    ? { ids: savedIds ?? [], access: savedAccess ?? {} }
    : draft ?? EMPTY, [chatId, draft, savedAccess, savedIds])
  const available = filesEnabled && !temporary && Boolean(namespace)

  const write = useCallback((ids: string[], access: Partial<Record<string, FileAccessMode>>) => {
    if (chatId) {
      const store = usePrototypeStore.getState()
      store.setChatFileScope(chatId, ids)
      return
    }
    useNewChatFileScope.getState().set(namespace, { ids, access: scopedFileAccess(ids, access as Record<string, FileAccessMode>) })
  }, [chatId, namespace])

  return {
    ...scope,
    available,
    add: (ids) => {
      const next = addFileScope(scope.ids, ids)
      const kept = next.slice(0, MAX_CHAT_FILE_SCOPES)
      if (kept.length !== scope.ids.length) write(kept, scope.access)
      return next.length - kept.length
    },
    remove: (id) => write(scope.ids.filter((item) => item !== id), scope.access),
    setAccess: (id, mode) => {
      if (!scope.ids.includes(id)) return
      if (chatId) usePrototypeStore.getState().setChatFileAccess(chatId, id, mode)
      else useNewChatFileScope.getState().set(namespace, { ids: scope.ids, access: { ...scope.access, [id]: mode } })
    },
    accessOf: (id) => scope.access[id] ?? DEFAULT_FILE_ACCESS_MODE,
  }
}

export const ACCESS_MODE_LABELS: Record<FileAccessMode, { title: string; detail: string; symbol: string }> = {
  read: { title: 'Read Only', detail: 'The agent can read but not change it', symbol: 'eye' },
  suggest: { title: 'Suggest Changes', detail: 'You review each change first', symbol: 'text.badge.checkmark' },
  write: { title: 'Edit Directly', detail: 'Changes apply at once; undo from the reply', symbol: 'pencil' },
}
