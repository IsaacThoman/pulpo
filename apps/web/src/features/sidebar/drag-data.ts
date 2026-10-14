import type { FileNode } from '@pulpo/contracts'

/** Drag data for items dragged out of the sidebar, so folders in Files can take them. */
const SIDEBAR_ITEM_TYPE = 'application/x-pulpo-item'

export type SidebarDragItem = Pick<FileNode, 'id' | 'kind' | 'name' | 'parentId'>

export function writeSidebarItems(dataTransfer: DataTransfer, items: readonly SidebarDragItem[]) {
  dataTransfer.setData(SIDEBAR_ITEM_TYPE, JSON.stringify(items.map(({ id, kind, name, parentId }) => ({ id, kind, name, parentId }))))
}

/** Whether a drag carries sidebar items; their data can only be read on drop. */
export function isSidebarItemDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(SIDEBAR_ITEM_TYPE)
}

/** The dragged sidebar items as Files items, enough to move them (with undo). */
export function readSidebarItems(dataTransfer: DataTransfer): FileNode[] {
  try {
    const items = JSON.parse(dataTransfer.getData(SIDEBAR_ITEM_TYPE)) as SidebarDragItem[]
    if (!Array.isArray(items)) return []
    return items.filter((item) => typeof item?.id === 'string').map((item) => ({
      ...item, status: 'ready', mimeType: null, sizeBytes: 0, revision: 0, trashedAt: null,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }))
  } catch {
    return []
  }
}
