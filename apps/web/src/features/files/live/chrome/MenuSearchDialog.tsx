import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { Check, Circle, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import type { MenuDefinition } from './menu'
import { flattenMenus, searchMenuCommands, type MenuCommand } from './menu-search'
import { ariaKeyShortcuts, formatShortcut } from './shortcuts'

/** PageUp and PageDown move this many rows. */
const PAGE = 8

/**
 * Google Docs' "Search the menus" (Alt+/, Help ▸): one field finds any command of the menu bar by
 * its name or its menus' names ("format bold"), in the current language, and runs it with Enter.
 * The list shows where each command lives, its keys, and whether it is on or greyed. Commands are
 * read from the menus as the dialog opens, as a menu reads its state when it opens. Closing hands
 * focus to `returnFocus` right away, unless the command moved it on (a dialog, the title field).
 */
export function MenuSearchDialog({ open, onOpenChange, menus, returnFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  menus: readonly MenuDefinition[]
  /** Puts focus back where typing goes, e.g. into the document. */
  returnFocus?: () => void
}) {
  const [query, setQuery] = useState('')
  const [commands, setCommands] = useState<MenuCommand[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(false)
  // Read the menus once per opening, in the render that opens it, so the list never flashes empty.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setCommands(flattenMenus(menus))
      setQuery('')
      setActiveKey(null)
    }
  }
  const results = useMemo(() => searchMenuCommands(commands, query), [commands, query])
  const listId = useId()
  const content = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Focus went back (or a command took it) for this closing; the dialog's own close leaves it be.
  const handedBack = useRef(false)

  // The row Enter runs: the one picked, else the best that can run.
  const found = results.findIndex((command) => command.key === activeKey)
  const activeIndex = found >= 0 ? found : Math.max(0, results.findIndex((command) => !command.disabled))
  const active = results[activeIndex]
  const optionId = (index: number) => `${listId}-${index}`

  const handBack = () => {
    if (handedBack.current) return
    handedBack.current = true
    const focused = document.activeElement
    // A command that took focus (a dialog's field, the title) keeps it.
    if (focused && focused !== document.body && !content.current?.contains(focused)) return
    returnFocus?.()
  }

  const close = (then?: () => void) => {
    handedBack.current = false
    // Closed first, so the focus trap is gone before the command or the hand-back moves focus.
    flushSync(() => onOpenChange(false))
    then?.()
    handBack()
  }

  const run = (command: MenuCommand | undefined) => {
    if (!command || command.disabled) return
    close(command.onSelect)
  }

  const moveTo = (index: number) => {
    const command = results[index]
    if (!command) return
    setActiveKey(command.key)
    document.getElementById(optionId(index))?.scrollIntoView?.({ block: 'nearest' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !results.length) return
    const last = results.length - 1
    const next = event.key === 'ArrowDown' ? (activeIndex >= last ? 0 : activeIndex + 1)
      : event.key === 'ArrowUp' ? (activeIndex <= 0 ? last : activeIndex - 1)
        : event.key === 'PageDown' ? Math.min(last, activeIndex + PAGE)
          : event.key === 'PageUp' ? Math.max(0, activeIndex - PAGE)
            : null
    if (next !== null) {
      event.preventDefault()
      moveTo(next)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!event.repeat) run(active)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        ref={content}
        showCloseButton={false}
        // Where the app's own search opens, as Docs' list drops from the top.
        className="top-[max(1rem,15dvh)] flex max-h-[min(34rem,calc(85dvh-1rem))] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        data-menu-search-dialog=""
        onOpenAutoFocus={() => { handedBack.current = false }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          handBack()
        }}
      >
        <DialogTitle className="sr-only">{ui("Search the menus")}</DialogTitle>
        <DialogDescription className="sr-only">{ui("Type a command, then press Enter to run it.")}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveKey(null)
              if (list.current) list.current.scrollTop = 0
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-label={ui("Search the menus")}
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={active ? optionId(activeIndex) : undefined}
            placeholder={ui("Search the menus")}
            autoComplete="off"
            spellCheck={false}
            // 16px on phones, so iOS does not zoom into the field.
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">{ui("esc")}</kbd>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label={ui("Commands")} className={cn('min-h-0 flex-1 overflow-y-auto p-1.5', !results.length && 'hidden')}>
          {results.map((command, index) => (
            <div
              key={command.key}
              id={optionId(index)}
              role="option"
              // Read as "Bold, Format, Text, ⌘B": the label, where it lives, and its keys.
              aria-label={[command.label, ...command.path, command.shortcut && formatShortcut(command.shortcut)].filter(Boolean).join(', ')}
              aria-selected={index === activeIndex}
              aria-disabled={command.disabled || undefined}
              aria-checked={command.checked}
              aria-keyshortcuts={command.shortcut ? ariaKeyShortcuts(command.shortcut) : undefined}
              data-menu-command={command.key}
              // The field keeps focus (and its caret) while the pointer picks a row.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (index !== activeIndex) setActiveKey(command.key) }}
              onClick={() => run(command)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm select-none',
                index === activeIndex && 'bg-accent text-accent-foreground',
                command.disabled && 'cursor-default opacity-50',
                command.destructive && 'text-destructive',
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
                {command.checked ? (command.radio ? <Circle className="size-2 fill-current" /> : <Check className="size-4" />)
                  : command.icon ? <command.icon className="size-4" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                <span className="min-w-0 truncate">{command.label}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{command.path.join(' ▸ ')}</span>
              </span>
              {command.shortcut && <kbd className="shrink-0 pl-2 font-sans text-xs text-muted-foreground">{formatShortcut(command.shortcut)}</kbd>}
            </div>
          ))}
        </div>
        {!results.length && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">{ui("No commands match “{{query}}”", { query: query.trim() })}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
