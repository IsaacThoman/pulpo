import type { FileNode } from '@pulpo/contracts'

/** Drag data for an item dragged out of the sidebar, so folders in Files can take it. */
const SIDEBAR_ITEM_TYPE = 'application/x-pulpo-item'

type SidebarDragItem = Pick<FileNode, 'id' | 'kind' | 'name' | 'parentId'>

export function writeSidebarItem(dataTransfer: DataTransfer, item: SidebarDragItem) {
  dataTransfer.setData(SIDEBAR_ITEM_TYPE, JSON.stringify({ id: item.id, kind: item.kind, name: item.name, parentId: item.parentId }))
}

/** Whether a drag carries a sidebar item; its data can only be read on drop. */
export function isSidebarItemDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(SIDEBAR_ITEM_TYPE)
}

/** The dragged sidebar item as a Files item, enough to move it (with undo). */
export function readSidebarItem(dataTransfer: DataTransfer): FileNode | null {
  try {
    const item = JSON.parse(dataTransfer.getData(SIDEBAR_ITEM_TYPE)) as SidebarDragItem
    if (typeof item?.id !== 'string') return null
    return {
      ...item, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, trashedAt: null,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}
