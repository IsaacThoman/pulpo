import { useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { DataProfile } from '@pulpo/contracts'
import { useProfiles, saveDataProfile, removeDataProfile } from '@/stores/profiles'
import { DataProfileBadge } from '@/components/DataProfileBadge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ui } from '@/i18n/ui'

const colors = ['#6366f1', '#0d9488', '#0284c7', '#d97706', '#e11d48', '#9333ea']

export function ProfilesSettings() {
  const { profiles, activeId } = useProfiles()
  const [editing, setEditing] = useState<DataProfile | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DataProfile | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(colors[0]!)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
  return <div>
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{ui('Profiles')}</h2>
      <Button variant="outline" size="sm" onClick={() => edit('new')}><Plus />{ui('Create profile')}</Button>
    </div>
    <Separator className="my-3" />
    <p className="text-sm text-muted-foreground">{ui('Keep chats, files, memories, and settings separate. Your account and billing stay shared.')}</p>
    <div className="mt-4 divide-y">
      {profiles.map((profile) => <div key={profile.id} className="flex min-w-0 items-center gap-3 py-4">
        <DataProfileBadge profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={profile.name}>{profile.name}</div>
          {profile.id === activeId && <div className="mt-0.5 text-xs text-muted-foreground">{ui('Current profile')}</div>}
        </div>
        <Button variant="ghost" size="icon" aria-label={ui('Edit {{name}}', { name: profile.name })} title={ui('Edit profile')} onClick={() => edit(profile)}><Pencil className="size-4" /></Button>
        <Button variant="ghost" size="icon" disabled={profiles.length === 1} aria-label={ui('Delete {{name}}', { name: profile.name })} title={ui('Delete profile')} onClick={() => { setDeleting(profile); setConfirmation(''); setError('') }}><Trash2 className="size-4 text-destructive" /></Button>
      </div>)}
    </div>
    <Dialog open={editing !== null || deleting !== null} onOpenChange={(open) => { if (!open && !busy) { setEditing(null); setDeleting(null) } }}><DialogContent><DialogHeader><DialogTitle>{ui(deleting ? 'Delete profile' : editing === 'new' ? 'Create profile' : 'Edit profile')}</DialogTitle><DialogDescription>{deleting ? ui('Permanently delete this profile’s chats, files, drafts, and memories. Type its name to confirm: {{name}}', { name: deleting.name }) : ui('Choose a name and color. New profiles start fresh.')}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <Input autoFocus aria-label={ui('Profile name')} value={deleting ? confirmation : name} maxLength={60} onChange={(event) => deleting ? setConfirmation(event.target.value) : setName(event.target.value)} />
        {!deleting && <div role="group" aria-label={ui('Profile color')} className="flex gap-3">{colors.map((value) => <button key={value} type="button" aria-label={value} aria-pressed={value === color} onClick={() => setColor(value)} className="grid size-9 place-items-center rounded-full text-white ring-offset-background aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-2" style={{ backgroundColor: value }}>{value === color && <Check className="size-4" />}</button>)}</div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" variant={deleting ? 'destructive' : 'default'} disabled={busy || (deleting ? confirmation !== deleting.name : !name.trim())}>{ui(busy ? 'Saving…' : deleting ? 'Delete profile' : 'Save')}</Button>
      </form>
    </DialogContent></Dialog>
  </div>
}
