import { DEFAULT_TRASH_COLOR, TRASH_FOLDER_ID, type FileNode } from '@pulpo/contracts'

/**
 * The trash is a built-in folder of My files, browsed like any other (as on the web, see
 * apps/web/src/features/trash/folder.ts). Files screens address it, and the trashed folders inside
 * it, with these references in place of a folder id.
 */
export { TRASH_FOLDER_ID }
const TRASHED_FOLDER_PREFIX = 'trash:'

/** Where a Files screen is in the trash: the trash itself (`folderId` null) or a trashed folder. Null outside it. */
export function trashLocation(ref: string | null): { folderId: string | null } | null {
  if (ref === TRASH_FOLDER_ID) return { folderId: null }
  if (ref?.startsWith(TRASHED_FOLDER_PREFIX)) return { folderId: ref.slice(TRASHED_FOLDER_PREFIX.length) }
  return null
}

/** The reference for the trash (null) or a trashed folder inside it. */
export const trashFolderRef = (folderId: string | null): string => folderId ? `${TRASHED_FOLDER_PREFIX}${folderId}` : TRASH_FOLDER_ID

export const isTrashFolder = (node: Pick<FileNode, 'id'>): boolean => node.id === TRASH_FOLDER_ID

/** The trash as an item of My files, in the trash's default color (the web lets it be changed). */
export function trashFolderNode(): FileNode {
  const epoch = new Date(0).toISOString()
  return {
    id: TRASH_FOLDER_ID, parentId: null, kind: 'folder', name: 'Trash', status: 'ready', mimeType: null, sizeBytes: 0,
    revision: 0, trashedAt: null, createdAt: epoch, updatedAt: epoch, systemRole: null, color: DEFAULT_TRASH_COLOR,
  }
}
