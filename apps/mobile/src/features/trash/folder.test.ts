import { describe, expect, it } from 'vitest'
import { isTrashFolder, TRASH_FOLDER_ID, trashFolderNode, trashFolderRef, trashLocation } from './folder'

describe('the trash folder', () => {
  it('is addressed like a folder, as are the trashed folders in it', () => {
    expect(trashLocation(TRASH_FOLDER_ID)).toEqual({ folderId: null })
    expect(trashLocation(trashFolderRef('abc'))).toEqual({ folderId: 'abc' })
    expect(trashFolderRef(null)).toBe(TRASH_FOLDER_ID)
    expect(trashLocation('abc')).toBeNull()
    expect(trashLocation(null)).toBeNull()
  })

  it('is listed in My files as a red folder', () => {
    const node = trashFolderNode()
    expect(isTrashFolder(node)).toBe(true)
    expect(node).toMatchObject({ kind: 'folder', name: 'Trash', parentId: null, color: 'red' })
  })
})
