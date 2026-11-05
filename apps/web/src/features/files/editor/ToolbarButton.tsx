import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** An editor toolbar's icon button; keeps the editor focused, and says whether a toggle is on. */
export function ToolbarButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string
  shortcut?: { label: string; aria: string }
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut?.aria}
      title={shortcut ? `${label} (${shortcut.label})` : label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  )
}

