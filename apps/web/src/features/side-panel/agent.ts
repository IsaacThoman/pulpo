import { useEffect } from 'react'
import { create } from 'zustand'
import { focusComposer } from '@/components/chat/composer-focus'
import { addFileScope } from '@/features/files/file-scope'
import { useChat } from '@/stores/chat'
import { useSidePanel, type PanelContent } from './store'

/*
 * Chats always live in the main view and Files beside them. A files view (a folder or a file,
 * on the page or in the panel) offers its items to the chat on the left: a new chat when none is
 * open, otherwise the chat that is.
 */

/** A file or folder id, or `root` for all files. */
export interface AgentItem {
  id: string
}

/** Where a files view is shown, and what it shows, so it can move into the panel. */
export interface FilesViewPlace {
  layout: 'page' | 'panel'
  view: PanelContent
}

/** The chat in the main view that files can be added to. */
export type ChatTarget = { kind: 'new' } | { kind: 'chat'; id: string }

export const useChatTarget = create<{ target: ChatTarget | null }>()(() => ({ target: null }))

/** Files items for the unsent new chat; the new-chat composer shows them as chips. */
export const useNewChatScope = create<{ scopeIds: string[] }>()(() => ({ scopeIds: [] }))

/** The files views on screen, so Cmd/Ctrl+J can act on what the user is looking at. */
export const useFilesViews = create<{ page: (FilesViewPlace & { item: AgentItem }) | null; panel: (FilesViewPlace & { item: AgentItem }) | null }>()(() => ({ page: null, panel: null }))

/** Registers the chat in the main view as the target for "Add to chat" while it is shown. */
export function usePublishChatTarget(target: ChatTarget | null): void {
  const key = target ? target.kind === 'new' ? 'new' : target.id : ''
  useEffect(() => {
    if (!key) return
    const published: ChatTarget = key === 'new' ? { kind: 'new' } : { kind: 'chat', id: key }
    useChatTarget.setState({ target: published })
    return () => { if (useChatTarget.getState().target === published) useChatTarget.setState({ target: null }) }
  }, [key])
}

/** Registers a files view and its current item while it is shown. */
export function usePublishFilesView(place: FilesViewPlace, item: AgentItem | null): void {
  const itemKey = item?.id ?? ''
  const viewKey = `${place.view.kind}:${place.view.id ?? ''}`
  const { layout } = place
  useEffect(() => {
    if (!itemKey) return
    const [kind, viewId] = viewKey.split(':') as ['file' | 'folder', string]
    const view: PanelContent = kind === 'file' ? { kind, id: viewId } : { kind, id: viewId || null }
    const published = { layout, view, item: { id: itemKey } }
    useFilesViews.setState({ [layout]: published })
    return () => { if (useFilesViews.getState()[layout] === published) useFilesViews.setState({ [layout]: null }) }
  }, [itemKey, layout, viewKey])
}

/**
 * Whether the item itself is attached. Items inside an attached folder can still be added, so
 * the agent knows the user pointed them out.
 */
export function scopeIncludes(scope: readonly string[], item: AgentItem): boolean {
  return scope.includes(item.id)
}

/** The Files scope of the chat in the main view. */
export function targetScope(target: ChatTarget | null, chats = useChat.getState().chats, draft = useNewChatScope.getState().scopeIds): string[] | null {
  if (!target) return null
  if (target.kind === 'new') return draft
  return chats.find((chat) => chat.id === target.id)?.fileScopeIds ?? []
}

/** Navigates the main view (see `useMainNavigate`). */
type Go = (pathname: string) => void

/** Moves a files view from the main view into the panel, leaving the main view for a chat. */
export function splitView(view: PanelContent, go: Go): void {
  useSidePanel.getState().open(view)
  go('/')
}

/** Starts a new chat in the main view with these items, moving a page view into the panel. */
export function openInNewChat(ids: string[], place: FilesViewPlace, go: Go): void {
  if (place.layout === 'page') useSidePanel.getState().open(place.view)
  useNewChatScope.setState({ scopeIds: addFileScope([], ids) })
  go('/')
  // Already on the new-chat page, nothing remounts to take focus.
  requestAnimationFrame(() => focusComposer())
}

/** Adds items to the chat in the main view. */
export function addToChat(ids: string[]): void {
  const target = useChatTarget.getState().target
  if (!target) return
  if (target.kind === 'new') {
    useNewChatScope.setState((state) => ({ scopeIds: addFileScope(state.scopeIds, ids) }))
  } else {
    const chat = useChat.getState().chats.find((item) => item.id === target.id)
    if (chat) useChat.getState().setChatFileScope(chat.id, addFileScope(chat.fileScopeIds ?? [], ids))
  }
  requestAnimationFrame(() => focusComposer())
}

/** The main agent action for a view: add to the open chat, or start one. */
export function primaryAgentAction(ids: string[], place: FilesViewPlace, go: Go): void {
  if (place.layout === 'panel' && useChatTarget.getState().target) addToChat(ids)
  else openInNewChat(ids, place, go)
}

/** Cmd/Ctrl+J: the main agent action for the files view in the main view, else the panel's. */
export function runAgentShortcut(go: Go): void {
  const { page, panel } = useFilesViews.getState()
  const place = page ?? panel
  if (!place) return
  const scope = targetScope(useChatTarget.getState().target)
  if (place.layout === 'panel' && scope && scopeIncludes(scope, place.item)) {
    focusComposer()
    return
  }
  primaryAgentAction([place.item.id], place, go)
}
