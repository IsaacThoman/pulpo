import { useQuery } from '@tanstack/react-query'
import type { FileReference } from '@pulpo/contracts'
import { Folder, X } from 'lucide-react'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useOpenBeside } from '@/features/side-panel/use-panel-actions'
import { fetchFileNode, fileNodeQueryKey } from './api'
import { FileNodeIcon } from './FileNodeIcon'

/**
 * A Files item mentioned in a message, shown like an attachment card so the two read as one kind
 * of thing. It differs where it behaves differently: an attachment is a copy sent with the message,
 * while this points at the live item, so its second line says where it is in Files, its icon has
 * a Files badge, and it opens in Files rather than in the attachment preview.
 */
export function FileReferenceCard({ reference, variant, onRemove }: {
  reference: FileReference
  /** `composer` matches the composer's attachment cards; `message` the ones in a sent message. */
  variant: 'composer' | 'message'
  onRemove?: () => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const openBeside = useOpenBeside()
  const query = useQuery({
    queryKey: fileNodeQueryKey(userId, reference.id),
    queryFn: () => fetchFileNode(reference.id),
    enabled: Boolean(userId),
    retry: false,
  })
  const node = query.data?.node
  const missing = query.isError || Boolean(node?.trashedAt)
  // The live name, once known: the message keeps the one it was sent with.
  const name = node && !missing ? node.name : reference.name
  const parent = query.data?.ancestors.at(-1)
  const place = missing
    ? ui("No longer in Files")
    : uit`In Files · ${parent?.name ?? ui("My files")}`
  const open = () => {
    if (missing) return
    openBeside(reference.folder ? { kind: 'folder', id: reference.id } : { kind: 'file', id: reference.id })
  }
  const details = (
    <>
      <span className={cn(
        'relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted/40 ring-1 ring-inset ring-border',
        missing && 'opacity-60',
      )}>
        {node
          ? <FileNodeIcon node={node} className="size-5" />
          : reference.folder
            ? <Folder className="size-5 text-muted-foreground" aria-hidden="true" />
            : <span className="size-5" />}
        <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full bg-background ring-1 ring-border" aria-hidden="true">
          <Folder className="size-2.5 text-sky-600 dark:text-sky-400" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium leading-5', missing && 'text-muted-foreground line-through')}>{name}</span>
        <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">{place}</span>
      </span>
    </>
  )
  return (
    <div
      title={missing ? place : uit`Open ${name} in Files`}
      className={cn(
        'group/reference relative flex min-w-0 items-center rounded-2xl border text-left shadow-sm transition-colors',
        variant === 'composer'
          ? 'w-64 max-w-full bg-muted/20 hover:bg-muted/35'
          : 'max-w-full bg-background/75 hover:border-foreground/15 hover:bg-background hover:shadow-md',
      )}
    >
      <button
        type="button"
        onClick={open}
        disabled={missing}
        aria-label={missing ? uit`${name}, no longer in Files` : uit`Open ${name} in Files`}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default',
          onRemove ? 'pr-11' : variant === 'message' && 'pr-4',
        )}
      >
        {details}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={uit`Remove ${name}`}
          onClick={onRemove}
          className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
