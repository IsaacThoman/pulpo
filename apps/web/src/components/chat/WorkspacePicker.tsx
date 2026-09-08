import { Check, ChevronDown, Cloud, Monitor, CircleOff } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { useQuery } from '@tanstack/react-query'
import type { WorkspaceComputer, WorkspaceSelection } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function WorkspacePicker({ value, onChange, disabled = false }: { value: WorkspaceSelection; onChange(value: WorkspaceSelection): void; disabled?: boolean }) {
  const userId = useAuth(state => state.user?.id)
  const { data } = useQuery({ queryKey: ['workspace-computers', userId], queryFn: () => apiRequest<{ computers: WorkspaceComputer[] }>('/api/me/computers'), enabled: !!userId, refetchInterval: 10_000 })
  const choices: Array<{ value: WorkspaceSelection; label: string; folder?: string; online?: boolean }> = [
    { value: { kind: 'none' }, label: ui('No workspace') }, { value: { kind: 'pulpo' }, label: 'Pulpo' },
    ...(data?.computers ?? []).flatMap(computer => computer.roots.map(root => ({ value: { kind: 'computer' as const, deviceId: computer.id, rootId: root.id }, label: computer.name, folder: root.path, online: computer.online }))),
  ]
  const matches = (choice: WorkspaceSelection) => choice.kind === value.kind && (choice.kind !== 'computer' || (value.kind === 'computer' && choice.deviceId === value.deviceId && choice.rootId === value.rootId))
  if (!choices.some(choice => matches(choice.value))) choices.push({ value, label: ui('Computer unavailable') })
  const selected = choices.find(choice => matches(choice.value))!
  const SelectedIcon = value.kind === 'computer' ? Monitor : value.kind === 'pulpo' ? Cloud : CircleOff
  const description = (choice: typeof selected) => [choice.label, choice.folder, choice.online === undefined ? undefined : choice.online ? ui('Online') : ui('Offline')].filter(Boolean).join(' · ')
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={`${ui('Workspace')}, ${description(selected)}`} title={description(selected)} disabled={disabled}
        className="group/workspace flex h-8 min-w-0 max-w-56 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
        <SelectedIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown className="size-3 shrink-0 rotate-180 opacity-60 transition-transform duration-200 group-data-[state=open]/workspace:rotate-0 motion-reduce:transition-none" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" className="w-72 max-w-[calc(100vw-2rem)]">
      <DropdownMenuLabel className="flex items-center gap-1.5 text-xs"><Monitor className="size-3.5" />{ui('Workspace')}</DropdownMenuLabel>
      {choices.map((choice, index) => {
        const Icon = choice.value.kind === 'computer' ? Monitor : choice.value.kind === 'pulpo' ? Cloud : CircleOff
        return <div key={JSON.stringify(choice.value)}>
          {index === 2 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => onChange(choice.value)} aria-label={description(choice)} className="justify-between">
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon className="size-3.5 opacity-70" />
              <span className="min-w-0">
                <span className="flex items-center gap-2"><span className="truncate">{choice.label}</span>{choice.online !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{choice.online ? ui('Online') : ui('Offline')}</span>}</span>
                {choice.folder && <span className="block truncate text-xs text-muted-foreground" title={choice.folder}>{choice.folder}</span>}
              </span>
            </span>
            {matches(choice.value) && <Check className="size-3.5 shrink-0" />}
          </DropdownMenuItem>
        </div>
      })}
    </DropdownMenuContent>
  </DropdownMenu>
}
