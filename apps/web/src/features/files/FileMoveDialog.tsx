import { useMemo } from 'react'
import type { FileNode } from '@pulpo/contracts'
import { ui, uit } from '@/i18n/ui'
import { FolderPickerDialog } from './FolderPickerDialog'

/** Picks a new folder for `nodes`, starting from their current folder. */
export function FileMoveDialog({
  nodes,
  onOpenChange,
  onMove,
}: {
  nodes: FileNode[] | null
  onOpenChange: (open: boolean) => void
  onMove: (nodes: FileNode[], parentId: string | null) => Promise<unknown>
}) {
  const moving = useMemo(() => new Set(nodes?.map((node) => node.id)), [nodes])

  return (
    <FolderPickerDialog
      open={Boolean(nodes?.length)}
      title={nodes?.length === 1 ? uit`Move "${nodes[0]!.name}"` : nodes?.length ? uit`Move ${nodes.length} items` : ui("Move")}
      description={ui("Choose a destination folder.")}
      confirmLabel={ui("Move here")}
      initialFolderId={nodes?.[0]?.parentId ?? null}
      disabledIds={moving}
      canConfirm={(folderId) => !nodes?.every((node) => node.parentId === folderId)}
      onOpenChange={onOpenChange}
      onConfirm={(folderId) => nodes?.length ? onMove(nodes, folderId) : Promise.resolve()}
    />
  )
}
