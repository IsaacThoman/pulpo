import { create } from 'zustand'
import type { FileNode } from '@pulpo/contracts'
import { openBeside, panelContentPath } from '@/features/side-panel/use-panel-actions'
import { useSidePanel } from '@/features/side-panel/store'
import type { FilesViewPlace } from '@/features/side-panel/agent'

/**
 * A file for a files view showing its folder to select, e.g. one just saved there. The layout
 * names the view that opens the folder, so another view already showing it does not take it.
 */
export const useFileReveal = create<{
  target: { folderId: string | null; nodeId: string; layout: FilesViewPlace['layout'] } | null
}>()(() => ({ target: null }))

/** Shows a file in its folder, beside the main view when there is room, with the file selected. */
export function revealFile(node: Pick<FileNode, 'id' | 'parentId'>, go: (pathname: string) => void): void {
  const layout = useSidePanel.getState().splitAvailable ? 'panel' : 'page'
  useFileReveal.setState({ target: { folderId: node.parentId, nodeId: node.id, layout } })
  openBeside({ kind: 'folder', id: node.parentId }, go)
}

/** Shows a file in its folder in place of the view showing the file, with the file selected. */
export function revealFileInPlace(node: Pick<FileNode, 'id' | 'parentId'>, inPanel: boolean, go: (pathname: string) => void): void {
  useFileReveal.setState({ target: { folderId: node.parentId, nodeId: node.id, layout: inPanel ? 'panel' : 'page' } })
  const folder = { kind: 'folder' as const, id: node.parentId }
  if (inPanel) useSidePanel.getState().open(folder)
  else go(panelContentPath(folder))
}
