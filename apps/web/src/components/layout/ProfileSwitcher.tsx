import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { DataProfile } from '@pulpo/contracts'
import { useProfiles, saveDataProfile, removeDataProfile } from '@/stores/profiles'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ui } from '@/i18n/ui'

const colors = ['#6366f1', '#0d9488', '#0284c7', '#d97706', '#e11d48', '#9333ea']
function Badge({ profile }: { profile: Pick<DataProfile, 'name' | 'color'> }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: profile.color }}>{profile.name.slice(0, 2).toLocaleUpperCase()}</span>
}

export function ProfileSwitcher({ collapsed = false, children }: { collapsed?: boolean; children?: ReactNode }) {
  const { profiles, activeId, select } = useProfiles()
  const active = profiles.find((profile) => profile.id === activeId)
  const [manage, setManage] = useState(false)
  const [editing, setEditing] = useState<DataProfile | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DataProfile | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(colors[0]!)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!active) return null
  const edit = (profile: DataProfile | 'new') => {
    setName(profile === 'new' ? '' : profile.name)
    setColor(profile === 'new' ? colors[0]! : profile.color)
    setError(''); setEditing(profile)
  }
  const submit = async () => {
    setBusy(true); setError('')
    try {
      if (deleting) { await removeDataProfile(deleting, confirmation); setDeleting(null) }
      else { await saveDataProfile({ name, color }, editing && editing !== 'new' ? editing.id : undefined); setEditing(null) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : ui('Could not save profile')) }
    finally { setBusy(false) }
  }
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button aria-label={ui('Switch profile')} title={active.name} className="mb-1 flex h-11 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-sidebar-accent"><Badge profile={active} />{!collapsed && <><span className="min-w-0 flex-1 truncate text-sm font-medium">{active.name}</span><ChevronDown className="mr-1 size-4 text-muted-foreground" /></>}</button></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{ui('Profiles')}</div>
        <div className="max-h-72 overflow-y-auto">{profiles.map((profile) => <DropdownMenuItem key={profile.id} onSelect={() => void select(profile.id)} className="gap-3 py-2"><Badge profile={profile} /><span className="flex-1 truncate">{profile.name}</span>{profile.id === activeId && <Check className="size-4" />}</DropdownMenuItem>)}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => edit('new')}><Plus />{ui('Create profile')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setManage(true)}><Pencil />{ui('Manage profiles')}</DropdownMenuItem>
        {children && <><DropdownMenuSeparator />{children}</>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={manage} onOpenChange={setManage}><DialogContent><DialogHeader><DialogTitle>{ui('Manage profiles')}</DialogTitle><DialogDescription>{ui('Keep chats, files, memories, and settings separate. Your account and billing stay shared.')}</DialogDescription></DialogHeader>
      <div className="max-h-96 space-y-2 overflow-y-auto">{profiles.map((profile) => <div key={profile.id} className="flex items-center gap-3 rounded-xl border p-3"><Badge profile={profile} /><span className="min-w-0 flex-1 truncate">{profile.name}</span><Button variant="ghost" size="icon" aria-label={ui('Rename profile')} onClick={() => edit(profile)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" disabled={profiles.length === 1} aria-label={ui('Delete profile')} onClick={() => { setDeleting(profile); setConfirmation(''); setError('') }}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div>
      <Button variant="outline" onClick={() => edit('new')}><Plus className="size-4" />{ui('Create profile')}</Button>
    </DialogContent></Dialog>
    <Dialog open={editing !== null || deleting !== null} onOpenChange={(open) => { if (!open && !busy) { setEditing(null); setDeleting(null) } }}><DialogContent><DialogHeader><DialogTitle>{ui(deleting ? 'Delete profile' : editing === 'new' ? 'Create profile' : 'Rename profile')}</DialogTitle><DialogDescription>{deleting ? ui('Permanently delete this profile’s chats, files, drafts, and memories. Type its name to confirm: {{name}}', { name: deleting.name }) : ui('Choose a name and color. New profiles start fresh.')}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <Input autoFocus aria-label={ui('Profile name')} value={deleting ? confirmation : name} maxLength={60} onChange={(event) => deleting ? setConfirmation(event.target.value) : setName(event.target.value)} />
        {!deleting && <div role="group" aria-label={ui('Profile color')} className="flex gap-3">{colors.map((value) => <button key={value} type="button" aria-label={value} aria-pressed={value === color} onClick={() => setColor(value)} className="grid size-9 place-items-center rounded-full text-white ring-offset-background aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-2" style={{ backgroundColor: value }}>{value === color && <Check className="size-4" />}</button>)}</div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" variant={deleting ? 'destructive' : 'default'} disabled={busy || (deleting ? confirmation !== deleting.name : !name.trim())}>{ui(busy ? 'Saving…' : deleting ? 'Delete profile' : 'Save')}</Button>
      </form>
    </DialogContent></Dialog>
  </>
}
