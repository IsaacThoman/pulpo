import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TextSearch } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { FILE_EDITOR_ATTRIBUTE } from './editor-root'
import { normalizeEntries, separator, type MenuDefinition, type MenuEntry } from './menu'
import { isMenuBarKey, isMenuSearchKey, MENU_SEARCH_ID, MENU_SEARCH_SHORTCUT, menuBarAriaKeys } from './menu-keys'
import { MenuSearchDialog } from './MenuSearchDialog'
import { ariaKeyShortcuts, formatShortcut } from './shortcuts'

/** An open menu's rows, built as it renders: Radix renders a menu's content only while it shows. */
function MenuItems({ items, close }: { items: () => MenuEntry[]; close: () => void }) {
  return <MenuEntries entries={items()} close={close} />
}

/** A menu's rows. Rows without an icon line up with those that have an icon or a check. */
export function MenuEntries({ entries, close }: { entries: readonly MenuEntry[]; close: () => void }) {
  const rows = normalizeEntries(entries)
  const aligned = rows.some((entry) => (entry.type === 'item' && entry.checked !== undefined) || ((entry.type === 'item' || entry.type === 'submenu') && entry.icon))
  return rows.map((entry, index) => {
    switch (entry.type) {
      case 'separator':
        return <DropdownMenuSeparator key={`separator-${index}`} />
      case 'label':
        return <DropdownMenuLabel key={`label-${index}`} inset={aligned || undefined} className="text-xs font-normal text-muted-foreground">{entry.label}</DropdownMenuLabel>
      case 'custom':
        return <Fragment key={entry.id}>{entry.render(close)}</Fragment>
      case 'submenu':
        return (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger disabled={entry.disabled} inset={(aligned && !entry.icon) || undefined} data-menu-item={entry.id}>
              {entry.icon && <entry.icon />}
              {entry.label}
            </DropdownMenuSubTrigger>
            {/* Never wider than the room beside its menu (a narrow window or the side panel): labels wrap instead. */}
            <DropdownMenuSubContent className="max-w-(--radix-dropdown-menu-content-available-width) min-w-[min(10rem,var(--radix-dropdown-menu-content-available-width))]">
              <MenuEntries entries={entry.items} close={close} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      case 'item': {
        const content = (
          <>
            {entry.icon && <entry.icon />}
            <span className="min-w-0 flex-1">{entry.label}</span>
            {entry.shortcut && <DropdownMenuShortcut className="pl-6 tracking-normal">{formatShortcut(entry.shortcut)}</DropdownMenuShortcut>}
          </>
        )
        const props = {
          disabled: entry.disabled,
          onSelect: entry.onSelect,
          'aria-keyshortcuts': entry.shortcut ? ariaKeyShortcuts(entry.shortcut) : undefined,
          'data-menu-item': entry.id,
        }
        if (entry.checked !== undefined) {
          return (
            <DropdownMenuCheckboxItem key={entry.id} checked={entry.checked} {...(entry.radio ? { role: 'menuitemradio' } : {})} {...props}>
              {content}
            </DropdownMenuCheckboxItem>
          )
        }
        return (
          <DropdownMenuItem key={entry.id} variant={entry.destructive ? 'destructive' : 'default'} inset={(aligned && !entry.icon) || undefined} {...props}>
            {content}
          </DropdownMenuItem>
        )
      }
    }
  })
}

/**
 * A Google Docs style menu bar ("File Edit View Insert Format Tools Help") for a slim row above an
 * editor's toolbar. One menu is open at a time; while one is, pointing at another opens it, and
 * ArrowLeft/ArrowRight move between them. Closing a menu without a command that moved focus on
 * (Escape, a command run, a click on nothing) calls `onClose`, which hands focus back to the
 * document. Menus are data (see `MenuDefinition`), built when each opens.
 *
 * Every editor's bar also searches its menus, as Docs' Help ▸ Search the menus does: a button at
 * the bar's end, the first item of the menu with id 'help', and Alt+/ (Option+/ on a Mac) anywhere
 * in the editor. Alt+Shift+F (Ctrl+Option+F on a Mac) in the editor opens the File menu, for the
 * keyboard. Both keys belong to the editor around the bar (its `data-file-editor` root) only, and
 * only when the editor itself left them alone.
 */
export function EditorMenuBar({ menus, onClose, className }: {
  menus: readonly MenuDefinition[]
  /** Called once a menu closes and focus has nowhere better to be: focus the editor. */
  onClose?: () => void
  className?: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  // Read by handlers that run between renders (a click on one trigger dismisses the other menu).
  const openRef = useRef<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  // Where focus was as the search opened: a field there (the formula bar, a find box) gets it back.
  const opener = useRef<Element | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const triggers = useRef<(HTMLButtonElement | null)[]>([])
  // The search button follows the menus in the bar's arrow-key order.
  const count = menus.length + 1

  const setOpen = (id: string | null) => {
    openRef.current = id
    setOpenId(id)
  }
  const step = (index: number, delta: number, length = count) => (index + delta + length) % length
  const close = () => setOpen(null)

  const openSearch = () => {
    // From Help ▸ Search the menus, the menu's item has focus: the document gets it back.
    opener.current = document.activeElement
    setOpen(null)
    setSearching(true)
  }

  const searchClosed = () => {
    const field = opener.current
    opener.current = null
    const root = bar.current?.closest(`[${FILE_EDITOR_ATTRIBUTE}]`)
    if (field instanceof HTMLElement && field.isConnected && root?.contains(field) && !bar.current?.contains(field) && field.matches('input, textarea, select')) {
      field.focus({ preventScroll: true })
    } else if (onClose) {
      onClose()
    } else {
      triggers.current[Math.min(focusIndex, count - 1)]?.focus()
    }
  }

  // Alt+Shift+F (Ctrl+Option+F) opens the File menu, or the first where there is none.
  const keyboardIndex = Math.max(0, menus.findIndex((menu) => menu.id === 'file'))
  /** The File menu, opened from the keyboard: its first item takes focus. */
  const openFromKeyboard = () => {
    setFocusIndex(keyboardIndex)
    setOpen(menus[keyboardIndex]!.id)
  }

  const keys = useRef({ openSearch, openFromKeyboard, hasMenus: menus.length > 0 })
  keys.current = { openSearch, openFromKeyboard, hasMenus: menus.length > 0 }
  useEffect(() => {
    // Scoped to this editor: another editor on the page, the chat, and dialogs (portals) keep
    // these keys. Heard on the window, after the editor's own handlers (React's too, such as a
    // notebook's command keys), so a key the editor took stays the editor's.
    const root = bar.current?.closest(`[${FILE_EDITOR_ATTRIBUTE}]`)
    if (!root) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.target instanceof Node) || !root.contains(event.target)) return
      const { openSearch, openFromKeyboard, hasMenus } = keys.current
      const action = isMenuSearchKey(event) ? openSearch : hasMenus && isMenuBarKey(event) ? openFromKeyboard : null
      if (!action) return
      event.preventDefault()
      if (!event.repeat) action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onTriggerKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'ArrowRight' ? step(index, 1)
      : event.key === 'ArrowLeft' ? step(index, -1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? count - 1
            : null
    if (next === null) return
    event.preventDefault()
    setFocusIndex(next)
    triggers.current[next]?.focus()
  }

  const onContentKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    // A submenu's trigger opens it on ArrowRight, and a submenu closes on ArrowLeft; both mark the key handled.
    if (event.defaultPrevented || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    // An open menu moves to the next menu, never to the search button.
    const next = step(index, event.key === 'ArrowRight' ? 1 : -1, menus.length)
    setFocusIndex(next)
    setOpen(menus[next]!.id)
  }

  // Help ▸ Search the menus comes first, as in Docs.
  const shown = menus.map((menu): MenuDefinition => menu.id !== 'help' ? menu : {
    ...menu,
    items: () => [
      { type: 'item', id: MENU_SEARCH_ID, label: ui("Search the menus"), icon: TextSearch, shortcut: MENU_SEARCH_SHORTCUT, onSelect: openSearch },
      separator,
      ...menu.items(),
    ],
  })

  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    // Moving to another menu, or a command took focus (a dialog, the title field): leave it there.
    if (openRef.current !== null) return
    const active = document.activeElement
    if (active && active !== document.body && !bar.current?.contains(active)) return
    if (onClose) onClose()
    else triggers.current[Math.min(focusIndex, count - 1)]?.focus()
  }

  return (
    <div
      ref={bar}
      role="menubar"
      aria-label={ui("Menu bar")}
      className={cn('flex h-7 min-w-0 shrink-0 items-center gap-px overflow-x-auto [scrollbar-width:none]', className)}
      data-editor-menubar=""
    >
      {shown.map((menu, index) => (
        <DropdownMenu
          key={menu.id}
          modal={false}
          open={openId === menu.id}
          onOpenChange={(open) => {
            if (open) {
              setFocusIndex(index)
              setOpen(menu.id)
            } else if (openRef.current === menu.id) {
              setOpen(null)
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              ref={(element) => { triggers.current[index] = element }}
              type="button"
              role="menuitem"
              tabIndex={index === Math.min(focusIndex, count - 1) ? 0 : -1}
              aria-keyshortcuts={index === keyboardIndex ? menuBarAriaKeys() : undefined}
              data-menu={menu.id}
              onKeyDown={onTriggerKeyDown(index)}
              onPointerEnter={(event) => {
                // Touch has no hover: a tap on another menu's name opens it through its trigger.
                if (event.pointerType === 'touch' || openRef.current === null || openRef.current === menu.id) return
                setFocusIndex(index)
                setOpen(menu.id)
              }}
              className="h-6 shrink-0 cursor-pointer rounded px-2 text-[13px] text-foreground/90 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent"
            >
              {menu.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={2}
            className="min-w-56"
            onKeyDown={onContentKeyDown(index)}
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <MenuItems items={menu.items} close={close} />
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      <button
        ref={(element) => { triggers.current[menus.length] = element }}
        type="button"
        role="menuitem"
        aria-label={ui("Search the menus")}
        aria-haspopup="dialog"
        aria-keyshortcuts={ariaKeyShortcuts(MENU_SEARCH_SHORTCUT)}
        title={`${ui("Search the menus")} (${formatShortcut(MENU_SEARCH_SHORTCUT)})`}
        tabIndex={menus.length === Math.min(focusIndex, count - 1) ? 0 : -1}
        data-menu-search=""
        onKeyDown={onTriggerKeyDown(menus.length)}
        // A click leaves focus where it was (a cell's formula, say), for the search to hand back.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setFocusIndex(menus.length)
          openSearch()
        }}
        // Stays in view at the end of a bar that scrolls (the side panel, a phone).
        className="sticky right-0 grid h-6 w-7 shrink-0 cursor-pointer place-items-center rounded bg-background text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <TextSearch className="size-3.5" />
      </button>
      <MenuSearchDialog open={searching} onOpenChange={setSearching} menus={menus} returnFocus={searchClosed} />
    </div>
  )
}
