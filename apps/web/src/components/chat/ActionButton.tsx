import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function ActionButton({
  label,
  active,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'className' | 'title' | 'aria-label'> & {
  label: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      {...props}
      title={label}
      aria-label={label}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
        active && 'text-foreground'
      )}
    >
      {children}
    </button>
  )
}
