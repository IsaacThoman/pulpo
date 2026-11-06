import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { writeClipboardText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

/** The bar above a file viewer: mode toggles on the left, actions on the right. */
export function ViewerToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-10 min-w-0 shrink-0 items-center gap-1 border-b bg-background px-2', className)} data-viewer-toolbar>
      {children}
    </div>
  )
}

export function ViewerToolbarSpacer() {
  return <div className="min-w-0 flex-1" />
}

/** Quiet status text in a toolbar or footer (line counts, the detected delimiter). */
export function ViewerStatus({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('min-w-0 truncate px-1.5 text-xs text-muted-foreground', className)} role="status">{children}</span>
}

export interface ViewModeOption<T extends string> {
  value: T
  label: string
  icon: ComponentType<{ className?: string }>
}

/** A segmented icon toggle, like the code preview's Preview/Code switch. */
export function ViewModeToggle<T extends string>({ value, options, onChange }: { value: T; options: readonly ViewModeOption<T>[]; onChange: (value: T) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          aria-label={label}
          title={label}
          onClick={() => onChange(option)}
          className={cn(
            'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground',
            value === option && 'bg-background text-foreground shadow-sm',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  )
}

/** A toolbar icon button that stays pressed while its option is on (soft wrap). */
export function ViewerToggleButton({ pressed, label, onClick, children }: { pressed: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('rounded-full text-muted-foreground', pressed && 'bg-accent text-foreground')}
    >
      {children}
    </Button>
  )
}

export function ViewerIconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="rounded-full text-muted-foreground">
      {children}
    </Button>
  )
}

export function ViewerCopyButton({ text, label }: { text: () => string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <ViewerIconButton
      label={copied ? ui("Copied") : label ?? ui("Copy text")}
      onClick={() => {
        void writeClipboardText(text()).then((success) => {
          if (!success) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </ViewerIconButton>
  )
}

export function FindButton({ onClick }: { onClick: () => void }) {
  return (
    <ViewerIconButton label={ui("Find")} onClick={onClick}>
      <Search className="size-4" />
    </ViewerIconButton>
  )
}

/**
 * Find within a viewer. Enter goes to the next match and Shift+Enter to the previous one; Escape
 * closes. `current` is zero-based; `total` may be capped, which `capped` says.
 */
export function FindBar({
  query,
  onQueryChange,
  current,
  total,
  capped = false,
  onNext,
  onPrevious,
  onClose,
}: {
  query: string
  onQueryChange: (query: string) => void
  current: number
  total: number
  capped?: boolean
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) onPrevious()
      else onNext()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }
  const count = total.toLocaleString(activeLocale())
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2" role="search" data-viewer-find>
      <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={ui("Find")}
        aria-label={ui("Find")}
        spellCheck={false}
        className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {query && (
        <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums" role="status" aria-live="polite">
          {total === 0
            ? ui("No results")
            : capped
              ? uit`${(current + 1).toLocaleString(activeLocale())} of ${count}+`
              : uit`${(current + 1).toLocaleString(activeLocale())} of ${count}`}
        </span>
      )}
      <ViewerIconButton label={ui("Previous match")} onClick={onPrevious} disabled={total === 0}>
        <ChevronUp className="size-4" />
      </ViewerIconButton>
      <ViewerIconButton label={ui("Next match")} onClick={onNext} disabled={total === 0}>
        <ChevronDown className="size-4" />
      </ViewerIconButton>
      <ViewerIconButton label={ui("Close find")} onClick={onClose}>
        <X className="size-4" />
      </ViewerIconButton>
    </div>
  )
}
