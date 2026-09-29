import type { ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export interface ContextMenuPoint {
  x: number
  y: number
}

/**
 * A right-click menu built on the dropdown menu: an invisible trigger sits at the pointer so
 * the menu gets the same styling, keyboard handling, and collision avoidance.
 */
export function FileContextMenu({ point, onClose, children }: {
  point: ContextMenuPoint | null
  onClose: () => void
  children: ReactNode
}) {
  if (!point) return null
  return (
    <DropdownMenu key={`${point.x}:${point.y}`} open onOpenChange={(open) => { if (!open) onClose() }} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: point.x, top: point.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-60" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
