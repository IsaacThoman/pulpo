import type { FileNode } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui, uit } from '@/i18n/ui'

/** Trashed items about to be deleted for good, or the whole trash. */
export type PendingTrashDeletion = { kind: 'items'; items: FileNode[] } | { kind: 'all' }

export function TrashDeleteDialog({ pending, onCancel, onConfirm }: {
  pending: PendingTrashDeletion | null
  onCancel: () => void
  onConfirm: () => void
}) {
  let description = ui("Everything in the trash will be permanently deleted. This cannot be undone.")
  if (pending?.kind === 'items') {
    const [first] = pending.items
    description = pending.items.length !== 1
      ? uit`${pending.items.length} items and everything inside them will be permanently deleted. This cannot be undone.`
      : first!.kind === 'folder'
        ? uit`"${first!.name}" and everything inside it will be permanently deleted. This cannot be undone.`
        : uit`"${first!.name}" will be permanently deleted. This cannot be undone.`
  }
  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.kind === 'all' ? ui("Empty the trash?") : ui("Delete forever?")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{ui("Cancel")}</Button>
          <Button variant="destructive" onClick={onConfirm}>{ui("Delete forever")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
