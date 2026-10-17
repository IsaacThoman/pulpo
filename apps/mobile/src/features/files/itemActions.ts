import type { FileNode } from '@pulpo/contracts'
import { isMarkdownName } from '@pulpo/contracts'
import type { ContextMenuAction } from '../../native/ItemContextMenuView'
import { isBuiltIn, openedKind } from './display'

export type FileItemActionId =
  | 'open'
  | 'add-to-chat'
  | 'open-in-new-chat'
  | 'rename'
  | 'move'
  | 'duplicate'
  | 'pin'
  | 'unpin'
  | 'share'
  | 'accept-suggestion'
  | 'reject-suggestion'
  | 'trash'
  | 'select'

export interface FileItemActionContext {
  /** Agent actions are offered where a chat can take Files (Files on, not a temporary chat). */
  agent: 'new-chat' | 'current-chat' | 'none'
  /** Whether the list can enter selection mode from this menu. */
  selectable: boolean
}

/** The menu for an item, as on the web's context menu, in the order iOS menus put them. */
export function fileItemActions(node: FileNode, context: FileItemActionContext): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [{ id: 'open', title: 'Open', systemImage: openedKind(node) === 'folder' ? 'folder' : 'arrow.up.forward.app', section: 0 }]
  // Chats and shortcuts cannot be attached to a chat; trashed shortcut targets cannot be opened.
  const attachable = node.kind !== 'chat' && node.kind !== 'shortcut' && node.status === 'ready'
  if (attachable && context.agent === 'current-chat') {
    actions.push({ id: 'add-to-chat', title: 'Add to Chat', systemImage: 'plus.bubble', section: 0 })
    actions.push({ id: 'open-in-new-chat', title: 'Open in New Chat', systemImage: 'square.and.pencil', section: 0 })
  } else if (attachable && context.agent === 'new-chat') {
    actions.push({ id: 'open-in-new-chat', title: 'Open in New Chat', systemImage: 'square.and.pencil', section: 0 })
  }
  if (node.suggestion) {
    actions.push({ id: 'accept-suggestion', title: 'Keep Suggested Item', systemImage: 'checkmark.circle', section: 1 })
    actions.push({ id: 'reject-suggestion', title: 'Remove Suggested Item', systemImage: 'xmark.circle', section: 1, destructive: true })
  }
  if (isBuiltIn(node)) {
    // The Chats folder is the sidebar's own list of chats, so it can't be pinned to it (as on the web).
    if (node.systemRole !== 'chats') actions.push({ id: node.pinned ? 'unpin' : 'pin', title: node.pinned ? 'Unpin' : 'Pin', systemImage: node.pinned ? 'pin.slash' : 'pin', section: 2 })
    return actions
  }
  actions.push({ id: 'rename', title: 'Rename', systemImage: 'pencil', section: 2 })
  actions.push({ id: 'move', title: 'Move…', systemImage: 'folder', section: 2 })
  if (node.kind !== 'chat') actions.push({ id: 'duplicate', title: 'Duplicate', systemImage: 'plus.square.on.square', section: 2 })
  actions.push({ id: node.pinned ? 'unpin' : 'pin', title: node.pinned ? 'Unpin' : 'Pin', systemImage: node.pinned ? 'pin.slash' : 'pin', section: 2 })
  if ((node.kind === 'blob' || node.kind === 'doc') && node.status === 'ready') actions.push({ id: 'share', title: node.kind === 'doc' ? 'Export…' : 'Share…', systemImage: 'square.and.arrow.up', section: 2 })
  if (context.selectable) actions.push({ id: 'select', title: 'Select', systemImage: 'checkmark.circle', section: 3 })
  actions.push({ id: 'trash', title: node.kind === 'chat' ? 'Delete Chat' : 'Move to Trash', systemImage: 'trash', section: 4, destructive: true })
  return actions
}

/** How an item opens: a folder in a new Files screen, a document in the editor, and so on. */
export type FileOpenTarget =
  | { type: 'folder'; id: string; name: string }
  | { type: 'document'; id: string; name: string }
  | { type: 'markdown'; id: string; name: string }
  /** An uploaded file; `node` is missing behind a shortcut, whose target's details load first. */
  | { type: 'file'; id: string; node?: FileNode }
  | { type: 'chat'; id: string }
  | { type: 'unavailable'; reason: string }

export function fileOpenTarget(node: FileNode): FileOpenTarget {
  if (node.kind === 'shortcut') {
    const target = node.target
    if (!target) return { type: 'unavailable', reason: 'This shortcut’s item no longer exists.' }
    if (!target.available) return { type: 'unavailable', reason: `“${target.name}” is in the trash. Restore it to open this shortcut.` }
    if (target.kind === 'folder') return { type: 'folder', id: target.id, name: target.name }
    if (target.kind === 'chat') return { type: 'chat', id: target.id }
    if (target.kind === 'doc') return { type: 'document', id: target.id, name: target.name }
    return isMarkdownName(target.name) ? { type: 'markdown', id: target.id, name: target.name } : { type: 'file', id: target.id }
  }
  if (node.status === 'pending') return { type: 'unavailable', reason: `“${node.name}” is still uploading.` }
  if (node.kind === 'folder') return { type: 'folder', id: node.id, name: node.name }
  if (node.kind === 'chat') return { type: 'chat', id: node.id }
  if (node.kind === 'doc') return { type: 'document', id: node.id, name: node.name }
  if (isMarkdownName(node.name)) return { type: 'markdown', id: node.id, name: node.name }
  return { type: 'file', id: node.id, node }
}
