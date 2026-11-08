import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ui } from '@/i18n/ui'
import { filterShortcutGroups, shortcutKeyText as keyText, type ShortcutGroup } from './shortcuts'

/**
 * An editor's keyboard shortcuts (Cmd/Ctrl+/ and Help ▸ Keyboard shortcuts), grouped, with a
 * search box like Google Docs'. Keys show in the platform's style. `groups` is called as the
 * dialog renders, so its labels can come from `ui()`.
 */
export function ShortcutsDialog({ open, onOpenChange, groups, title, description, returnFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: () => ShortcutGroup[]
  title?: string
  description?: string
  /** Where focus goes once the dialog closes, e.g. back into the document. */
  returnFocus?: () => void
}) {
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) setQuery('') }, [open])
  const shown = open ? filterShortcutGroups(groups(), query) : []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-3 sm:max-w-3xl"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return
          event.preventDefault()
          returnFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title ?? ui("Keyboard shortcuts")}</DialogTitle>
          <DialogDescription>{description ?? ui("Type to find a command and its keys.")}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={ui("Search shortcuts")}
          placeholder={ui("Search keyboard shortcuts")}
          autoFocus
        />
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6" data-shortcuts-list>
          {shown.length ? (
            <div className="grid gap-x-8 gap-y-5 py-1 sm:grid-cols-2">
              {shown.map((group) => (
                <section key={group.id} aria-label={group.title} className="min-w-0">
                  <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.title}</h3>
                  <dl className="space-y-1 text-sm">
                    {group.items.map((item) => (
                      <div key={`${item.label}:${item.keys.map(keyText).join(',')}`} className="flex items-baseline justify-between gap-4">
                        <dt className="min-w-0">{item.label}</dt>
                        <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                          {item.keys.map((key, index) => (
                            <kbd key={index} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">{keyText(key)}</kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{ui("No shortcuts match “{{query}}”", { query })}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
