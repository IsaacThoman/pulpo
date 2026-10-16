import type { FileColor, FileNode } from '@pulpo/contracts'

/**
 * The trash is a built-in folder at the top of My files, browsed like any other. Files views
 * address it, and the trashed folders inside it, with these references in place of a folder id.
 */
export const TRASH_FOLDER_ID = 'trash'
const TRASHED_FOLDER_PREFIX = 'trash:'

/** Where a Files view is in the trash: the trash itself (`folderId` null) or a trashed folder. Null outside it. */
export function trashLocation(ref: string | null): { folderId: string | null } | null {
  if (ref === TRASH_FOLDER_ID) return { folderId: null }
  if (ref?.startsWith(TRASHED_FOLDER_PREFIX)) return { folderId: ref.slice(TRASHED_FOLDER_PREFIX.length) }
  return null
}

/** The reference for the trash (null) or a trashed folder inside it. */
export const trashFolderRef = (folderId: string | null): string => folderId ? `${TRASHED_FOLDER_PREFIX}${folderId}` : TRASH_FOLDER_ID

export const isTrashFolder = (node: Pick<FileNode, 'id'>): boolean => node.id === TRASH_FOLDER_ID

/** Built-in folders stay where they are: they cannot be renamed, moved, or trashed. */
export const isBuiltInFolder = (node: Pick<FileNode, 'id' | 'systemRole'>): boolean => Boolean(node.systemRole) || isTrashFolder(node)

/** The page for a Files folder, the trash, or a trashed folder (`ref`), or My files (null). */
export function folderPath(ref: string | null): string {
  const trash = trashLocation(ref)
  if (trash) return trash.folderId ? `/files/trash/f/${trash.folderId}` : '/files/trash'
  return ref ? `/files/f/${ref}` : '/files'
}

/** The trash's color when the user has not chosen one. */
export const TRASH_DEFAULT_COLOR: FileColor = 'red'

/** The trash as an item of My files, in the color the user chose for it (setting `trashColor`). */
export function trashFolderNode(name: string, color: FileColor | null): FileNode {
  const epoch = new Date(0).toISOString()
  return {
    id: TRASH_FOLDER_ID, parentId: null, kind: 'folder', name, status: 'ready', mimeType: null, sizeBytes: 0,
    revision: 0, trashedAt: null, createdAt: epoch, updatedAt: epoch, systemRole: null, color,
  }
}
