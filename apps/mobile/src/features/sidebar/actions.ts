import type { FileNode } from '@pulpo/contracts'
import type { ContextMenuAction } from '../../native/ItemContextMenuView'

export type SidebarItemActionId = 'new-folder' | 'open' | 'pin' | 'unpin' | 'rename' | 'move' | 'archive' | 'trash'

export interface SidebarItemActionContext {
  /** The row opens a folder in place (a folder, or a shortcut to one). */
  folder: boolean
  filesEnabled: boolean
  /** In the Archive (or is it): Move to Archive would change nothing. */
  archived: boolean
  /** A chat folder from a server without the sidebar: it can only be renamed or deleted. */
  legacy?: boolean
}

/** What trashing an item is called: shortcuts are deleted, and without Files nothing shows the trash. */
export function sidebarTrashLabel(node: Pick<FileNode, 'kind'>, filesEnabled: boolean): string {
  return node.kind === 'shortcut' ? 'Delete Shortcut' : filesEnabled ? 'Move to Trash' : 'Delete'
}

/** Whether opening the item goes anywhere: a shortcut to something trashed does not, nor Files items without Files. */
export function sidebarItemOpens(node: FileNode, filesEnabled: boolean): boolean {
  if (node.kind === 'shortcut') return Boolean(node.target?.available) && (filesEnabled || node.target?.kind === 'chat')
  return filesEnabled
}

/**
 * The menu of a folder, file, or shortcut in the drawer, as the web sidebar's item menu has it
 * (without what needs a pointer or tabs). Built-in folders can only be opened and pinned.
 */
export function sidebarItemActions(node: FileNode, context: SidebarItemActionContext): ContextMenuAction[] {
  if (context.legacy) {
    return [
      { id: 'rename', title: 'Rename', systemImage: 'pencil', section: 0 },
      { id: 'trash', title: 'Delete Folder', systemImage: 'trash', section: 1, destructive: true },
    ]
  }
  const actions: ContextMenuAction[] = []
  const shortcut = node.kind === 'shortcut'
  const system = Boolean(node.systemRole)
  if (context.folder && !shortcut) actions.push({ id: 'new-folder', title: 'New Folder Inside', systemImage: 'folder.badge.plus', section: 0 })
  if (sidebarItemOpens(node, context.filesEnabled)) {
    actions.push({ id: 'open', title: context.folder ? 'Open in Files' : 'Open', systemImage: context.folder ? 'folder' : 'arrow.up.forward.app', section: 0 })
  }
  // The Chats folder is the sidebar itself; the Archive can be pinned like any folder.
  if (node.systemRole !== 'chats') {
    actions.push(node.pinned
      ? { id: 'unpin', title: 'Unpin', systemImage: 'pin.slash', section: 1 }
      : { id: 'pin', title: 'Pin', systemImage: 'pin', section: 1 })
  }
  if (system) return actions
  actions.push({ id: 'rename', title: 'Rename', systemImage: 'pencil', section: 1 })
  actions.push({ id: 'move', title: 'Move to Folder…', systemImage: 'folder', section: 1 })
  if (context.filesEnabled && !context.archived) actions.push({ id: 'archive', title: 'Move to Archive', systemImage: 'archivebox', section: 1 })
  actions.push({ id: 'trash', title: sidebarTrashLabel(node, context.filesEnabled), systemImage: 'trash', section: 2, destructive: true })
  return actions
}
