import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiRequest } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { runtimeAccountKey } from '@/lib/runtime'
import type { MonitorUser } from '@/lib/types'
import { ui } from '@/i18n/ui'
import { AUTOMATIC_MODEL_VALUE, defaultModelOptions } from './settings/new-account-model-defaults-logic'

export function EditUserDialog({ user, billingEnabled, onSave, onClose }: {
  user: MonitorUser
  billingEnabled: boolean
  onSave: (id: string, patch: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const initialModelId = user.defaultModelId || null
  const [defaultModelId, setDefaultModelId] = useState(initialModelId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const models = useQuery({
    queryKey: ['admin-user-models', runtimeAccountKey(user.id)],
    queryFn: ({ signal }) => apiRequest<{ data: { id: string; name: string }[] }>(`/api/admin/users/${user.id}/models`, { signal }),
  })

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const values = new FormData(event.currentTarget)
    const password = String(values.get('password') ?? '')
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(user.id, {
        name: values.get('name'), username: values.get('username'), email: values.get('email'),
        ...(billingEnabled ? { inviteCodeQuota: Number(values.get('inviteCodeQuota') ?? 0) } : {}),
        ...(password ? { password } : {}),
        ...(defaultModelId !== initialModelId ? { defaultModelId } : {}),
      })
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : ui('Could not save user.'))
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-sm">
      <form onSubmit={(event) => void save(event)} className="contents">
        <DialogHeader>
          <DialogTitle>{ui('Edit user')}</DialogTitle>
          <DialogDescription>{ui('Joined')} {formatDate(user.joinedAt)}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-name">{ui('Display name')}</Label>
            <Input id="edit-user-name" name="name" defaultValue={user.name} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-username">{ui('Username')}</Label>
            <Input id="edit-user-username" name="username" defaultValue={user.username} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{1,28}[a-z0-9]" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-email">{ui('Email')}</Label>
            <Input id="edit-user-email" name="email" type="email" defaultValue={user.email} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-password">{ui('New password')}</Label>
            <Input id="edit-user-password" name="password" type="password" minLength={8} placeholder={ui('Leave blank to keep')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-user-default-model">{ui('Default model')}</Label>
            <Select value={defaultModelId ?? AUTOMATIC_MODEL_VALUE}
              disabled={saving || models.isPending || models.isError}
              onValueChange={(value) => setDefaultModelId(value === AUTOMATIC_MODEL_VALUE ? null : value)}>
              <SelectTrigger id="edit-user-default-model" className="w-full min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                {defaultModelOptions(models.data?.data ?? [], defaultModelId).map((option) =>
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {models.isPending && <p role="status" className="text-xs text-muted-foreground">{ui('Loading models…')}</p>}
            {models.isError && <div className="flex items-center gap-2">
              <p role="alert" className="text-xs text-destructive">{ui('Could not load models.')}</p>
              <Button type="button" variant="outline" size="sm" disabled={models.isFetching} onClick={() => void models.refetch()}>{ui('Retry')}</Button>
            </div>}
          </div>
          {billingEnabled && <div className="space-y-1.5">
            <Label htmlFor="edit-user-invite-quota">{ui('Invite code quota')}</Label>
            <Input id="edit-user-invite-quota" name="inviteCodeQuota" type="number" min={0} max={1000} defaultValue={user.inviteCodeQuota ?? 0} />
          </div>}
        </fieldset>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <DialogFooter><Button type="submit" disabled={saving}>{saving ? ui('Saving…') : ui('Save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
