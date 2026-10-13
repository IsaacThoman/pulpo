import { useState } from 'react'
import { Check, Search, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { ui, uit } from '@/i18n/ui'
import { matchesUserQuery, type UserDirectory } from './user-directory'

export function ModelAccessEditor({ allowedUserIds, directory: { users, loading }, onChange }: {
  allowedUserIds: string[]
  directory: UserDirectory
  onChange: (allowedUserIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const allowed = new Set(allowedUserIds)
  // Admins always have access, so they are never offered as grants.
  const grantable = users.filter((user) => user.role !== 'admin' && !user.deletionRequestedAt)
    .sort((left, right) => left.name.localeCompare(right.name))
  const selected = allowedUserIds.flatMap((id) => users.find((user) => user.id === id) ?? [])
  const options = grantable.filter((user) => matchesUserQuery(user, query))
  const toggle = (id: string) => onChange(allowed.has(id) ? allowedUserIds.filter((value) => value !== id) : [...allowedUserIds, id])

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{ui("Allowed users")}</span>
        <Badge variant="secondary" className="font-normal">{selected.length}</Badge>
        <div className="flex-1" />
        <Popover open={open} onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}>
          <PopoverAnchor asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={open}
              onClick={(event) => {
                setPortalContainer(event.currentTarget.closest<HTMLElement>('[data-slot="dialog-content"]'))
                setOpen((current) => !current)
              }}
            >
              <UserPlus /> {ui("Add users")}
            </Button>
          </PopoverAnchor>
          <PopoverContent
            align="end"
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
                placeholder={ui("Search by name, username, or email…")}
                aria-label={ui("Search users")}
                className="h-8 pl-8"
              />
            </div>
            <ScrollArea className="h-64">
              <div className="p-1">
                {options.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={allowed.has(user.id)}
                    className={cn('flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent', allowed.has(user.id) && 'bg-accent/60')}
                    onClick={() => toggle(user.id)}
                  >
                    <ProfileAvatar name={user.name} avatarUrl={user.avatarUrl} className="size-6 shrink-0" fallbackClassName="text-[9px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">@{user.username} · {user.email}</span>
                    </span>
                    <Check className={cn('size-4 shrink-0', !allowed.has(user.id) && 'invisible')} />
                  </button>
                ))}
              </div>
              {!options.length && (
                <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                  {loading ? ui("Loading users…") : ui("No matching users")}
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>
      {selected.length ? (
        <ul className="divide-y rounded-md border">
          {selected.map((user) => (
            <li key={user.id} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
              <ProfileAvatar name={user.name} avatarUrl={user.avatarUrl} className="size-6 shrink-0" fallbackClassName="text-[9px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
              </span>
              <Button type="button" size="icon-sm" variant="ghost" title={uit`Remove ${user.name}`} onClick={() => toggle(user.id)}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {loading && allowedUserIds.length ? ui("Loading users…") : ui("No users selected. Only admins can use this model.")}
        </p>
      )}
    </div>
  )
}
