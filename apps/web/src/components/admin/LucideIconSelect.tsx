import { useMemo, useState } from 'react'
import type { ChatPresetIcon } from '@pulpo/contracts'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PresetIcon } from '@/components/chat/PresetIcon'
import { filterPresetIconOptions, formatPresetIconLabel } from '@/components/chat/preset-icon-options'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

/** Searchable picker over every Lucide icon, with popular icons shown before a search. */
export function LucideIconSelect({
  value,
  allowDefault = false,
  ariaLabel = ui("Choose preset icon"),
  onChange,
}: {
  value: ChatPresetIcon | null | undefined
  allowDefault?: boolean
  ariaLabel?: string
  onChange: (value: ChatPresetIcon | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Keep the portal inside Radix Dialog's scroll-lock boundary so its viewport receives wheel events.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const selected = value ?? (allowDefault ? null : 'circle')
  const options = useMemo(() => filterPresetIconOptions(query), [query])

  const select = (icon: ChatPresetIcon | null) => {
    onChange(icon)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      if (!next) setQuery('')
    }}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="h-8 w-full justify-between px-2 font-normal"
          onClick={(event) => {
            setPortalContainer(event.currentTarget.closest<HTMLElement>('[data-slot="dialog-content"]'))
            setOpen((current) => !current)
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? <PresetIcon name={selected} /> : <CircleIconPlaceholder />}
            <span className="truncate">{selected ? formatPresetIconLabel(selected) : ui("Default")}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        container={portalContainer}
        sideOffset={2}
        className="w-[min(22rem,var(--radix-popper-available-width))] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="relative border-b p-2">
          <Search className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui("Search Lucide icons…")}
            aria-label={ui("Search Lucide icons")}
            className="h-8 pl-8"
          />
        </div>
        <ScrollArea className="h-64">
          <div className="grid grid-cols-2 gap-1 p-1">
            {allowDefault && !query.trim() && (
              <button
                type="button"
                className={cn('flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent', selected === null && 'bg-accent')}
                onClick={() => select(null)}
              >
                <CircleIconPlaceholder />
                <span>{ui("Default")}</span>
                {selected === null && <Check className="ml-auto size-3.5" />}
              </button>
            )}
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.id}
                className={cn('flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent', selected === option.id && 'bg-accent')}
                onClick={() => select(option.id)}
              >
                <PresetIcon name={option.id} className="shrink-0" />
                <span className="truncate">{option.label}</span>
                {selected === option.id && <Check className="ml-auto size-3.5 shrink-0" />}
              </button>
            ))}
          </div>
          {!options.length && <div className="px-2 py-8 text-center text-xs text-muted-foreground">{ui("No matching icons")}</div>}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function CircleIconPlaceholder() {
  return <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-current opacity-50" />
}
