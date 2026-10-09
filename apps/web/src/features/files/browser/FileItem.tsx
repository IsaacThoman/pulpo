import type { DragEvent, MouseEvent, PointerEvent } from 'react'
import type { FileNode } from '@pulpo/contracts'
import { MoreHorizontal } from 'lucide-react'
import { uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dropFolderOf, fileKindLabel } from '../file-display'
import { FileNodeIcon } from '../FileNodeIcon'
import { InlineRename } from './InlineRename'

export interface FileDropHandlers {
  onDragOver: (event: DragEvent) => void
  onDragLeave: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}

export interface FileItemProps {
  node: FileNode
  view: 'list' | 'grid'
  /** Where a grid tile sits on a freely arranged canvas. */
  position?: { x: number; y: number }
  selected: boolean
  focused: boolean
  cut: boolean
  /** Part of the selection currently being dragged; shown faded in place. */
  dragging: boolean
  dropActive: boolean
  renaming: boolean
  onPointerDown: (event: PointerEvent) => void
  onClick: (event: MouseEvent) => void
  onDoubleClick: (event: MouseEvent) => void
  onContextMenu: (event: MouseEvent) => void
  onMenuButton: (event: MouseEvent<HTMLButtonElement>) => void
  /** Accepts files dropped in from the operating system (folders only). */
  dropHandlers?: FileDropHandlers
  onRenameCommit: (name: string) => Promise<boolean>
  onRenameCancel: () => void
}

/** One row (list view) or tile (grid view). Selection and opening are handled by the browser. */
export function FileItem(props: FileItemProps) {
  const { node, view, selected, focused, cut, dragging, dropActive, renaming } = props
  const name = renaming
    ? <InlineRename node={node} onCommit={props.onRenameCommit} onCancel={props.onRenameCancel} className={view === 'grid' ? 'w-full' : undefined} />
    : <span className={cn('min-w-0 text-sm', view === 'grid' ? 'line-clamp-2 w-full break-words' : 'truncate')} title={node.name}>{node.name}</span>
  const menuButton = (
    <button
      type="button"
      tabIndex={-1}
      className={cn(
        'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground',
        view === 'grid' && 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
        view === 'grid' && selected && 'sm:opacity-100',
      )}
      aria-label={uit`Actions for ${node.name}`}
      onClick={(event) => { event.stopPropagation(); props.onMenuButton(event) }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <MoreHorizontal className="size-4" />
    </button>
  )
  const shared = {
    'data-file-id': node.id,
    role: 'option' as const,
    'aria-selected': selected,
    // Folders are drop targets for items dragged within Files (see useItemDrag).
    'data-drop-target': dropFolderOf(node),
    draggable: false,
    onPointerDown: props.onPointerDown,
    onClick: props.onClick,
    onDoubleClick: props.onDoubleClick,
    onContextMenu: props.onContextMenu,
    ...props.dropHandlers,
  }

  if (view === 'grid') {
    return (
      <div
        {...shared}
        style={props.position && { left: props.position.x, top: props.position.y }}
        className={cn(
          'group flex cursor-default flex-col items-center gap-2 rounded-xl px-3 pt-6 pb-3 text-center transition-colors select-none hover:bg-accent/60',
          props.position ? 'absolute w-32' : 'relative',
          selected && 'bg-sky-500/15 ring-1 ring-sky-500/50 hover:bg-sky-500/20 dark:bg-sky-400/15',
          focused && 'ring-2 ring-sky-500/70',
          (cut || dragging) && 'opacity-50',
          dropActive && 'bg-sky-500/20 ring-2 ring-sky-500/60',
        )}
      >
        <FileNodeIcon node={node} className="size-11" />
        {name}
        <div className="absolute top-1 right-1">{menuButton}</div>
      </div>
    )
  }

  return (
    <div
      {...shared}
      className={cn(
        // Columns follow the list's own width (it may sit beside the side panel), not the window's.
        'grid cursor-default grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 px-3 transition-colors select-none hover:bg-accent/50 @lg:grid-cols-[minmax(0,1fr)_6rem_2.5rem] @2xl:grid-cols-[minmax(0,1fr)_9rem_6.5rem_6rem_2.5rem]',
        // Inset shadow draws the accent bar: a global border-color rule overrides border utilities.
        selected && 'bg-sky-500/15 shadow-[inset_3px_0_0_var(--color-sky-500)] hover:bg-sky-500/20 dark:bg-sky-400/15',
        focused && 'outline-2 -outline-offset-2 outline-sky-500/60',
        (cut || dragging) && 'opacity-50',
        dropActive && 'bg-sky-500/20 outline-2 -outline-offset-2 outline-sky-500/60',
      )}
    >
      <span className="flex min-w-0 items-center gap-3 py-2">
        <FileNodeIcon node={node} className="size-5" />
        {name}
      </span>
      <span className="hidden truncate text-sm text-muted-foreground @2xl:block">{timeAgo(Date.parse(node.updatedAt))}</span>
      <span className="hidden truncate text-sm text-muted-foreground @2xl:block">{fileKindLabel(node)}</span>
      <span className="hidden text-right text-sm text-muted-foreground tabular-nums @lg:block">{node.kind === 'folder' || node.kind === 'chat' || node.kind === 'shortcut' ? '—' : formatBytes(node.sizeBytes)}</span>
      {menuButton}
    </div>
  )
}
