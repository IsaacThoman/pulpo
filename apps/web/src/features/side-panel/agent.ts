import { useEffect } from 'react'
import { create } from 'zustand'
import { focusComposer } from '@/components/chat/composer-focus'
import { FILE_SCOPE_ROOT } from '@pulpo/contracts'
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

/**
 * Files items on their way to a chat's composer, which adds them to its message as references
 * once it is mounted (a new chat's composer mounts after the navigation that opens it).
 */
export const usePendingReferences = create<{ target: ChatTarget | null; ids: string[] }>()(() => ({ target: null, ids: [] }))

function sameTarget(left: ChatTarget | null, right: ChatTarget | null): boolean {
  if (!left || !right) return false
  return left.kind === 'new' ? right.kind === 'new' : right.kind === 'chat' && right.id === left.id
}

/** Hands items to the composer of `target`. Items are files and folders; all of My files is not one. */
function sendReferences(target: ChatTarget, ids: string[]): void {
  const items = ids.filter((id) => id !== FILE_SCOPE_ROOT)
  if (!items.length) return
  usePendingReferences.setState((state) => ({
    target,
    ids: sameTarget(state.target, target) ? [...new Set([...state.ids, ...items])] : items,
  }))
}

/** Takes the items waiting for this composer's chat, if any. */
export function takePendingReferences(target: ChatTarget): string[] {
  const { target: pendingTarget, ids } = usePendingReferences.getState()
  if (!sameTarget(pendingTarget, target) || !ids.length) return []
  usePendingReferences.setState({ target: null, ids: [] })
  return ids
}

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

/** Navigates the main view (see `useMainNavigate`). */
type Go = (pathname: string) => void

/** Moves a files view from the main view into the panel, leaving the main view for a chat: a new one, or `chatId`. */
export function splitView(view: PanelContent, go: Go, chatId?: string): void {
  useSidePanel.getState().open(view)
  go(chatId ? `/c/${chatId}` : '/')
}

/**
 * Starts a new chat in the main view with these items, moving a page view into the panel when
 * there is room for both; otherwise the chat simply takes the main view. Without a place (from
 * outside any files view) only the chat opens.
 */
export function openInNewChat(ids: string[], place: FilesViewPlace | null, go: Go): void {
  if (place?.layout === 'page' && useSidePanel.getState().splitAvailable) useSidePanel.getState().open(place.view)
  usePendingReferences.setState({ target: null, ids: [] })
  sendReferences({ kind: 'new' }, ids)
  go('/')
  // Already on the new-chat page, nothing remounts to take focus.
  requestAnimationFrame(() => focusComposer())
}

/** Adds items to the message being written in the chat in the main view. */
export function addToChat(ids: string[]): void {
  const target = useChatTarget.getState().target
  if (!target) return
  sendReferences(target, ids)
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
  primaryAgentAction([place.item.id], place, go)
}
