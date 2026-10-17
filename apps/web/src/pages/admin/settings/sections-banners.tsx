import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Banner, BannerType } from '@pulpo/contracts'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Section, SelectField, TextAreaField, Toggle } from '@/components/admin/kit'
import { BannerCard } from '@/components/layout/BannerCard'
import { apiRequest } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'
import {
  EMPTY_BANNER_DRAFT,
  bannerDraftError,
  bannerInputFromDraft,
  bannerStatus,
  draftFromBanner,
  type BannerDraft,
  type BannerDraftError,
  type BannerStatus,
} from './banners-logic'

function typeLabel(type: BannerType): string {
  switch (type) {
    case 'info': return ui("Info")
    case 'warning': return ui("Warning")
    case 'error': return ui("Error")
  }
}

function statusLabel(status: BannerStatus): string {
  switch (status) {
    case 'active': return ui("Active")
    case 'scheduled': return ui("Scheduled")
    case 'expired': return ui("Expired")
  }
}

function draftErrorLabel(error: BannerDraftError): string {
  switch (error) {
    case 'content-required': return ui("Enter a message.")
    case 'content-too-long': return ui("Messages can be at most 2,000 characters.")
    case 'invalid-window': return ui("The end time must be after the start time.")
  }
}

function scheduleLabel(banner: Banner): string {
  if (banner.startsAt && banner.endsAt) return `${formatDateTime(Date.parse(banner.startsAt))} – ${formatDateTime(Date.parse(banner.endsAt))}`
  if (banner.startsAt) return uit`From ${formatDateTime(Date.parse(banner.startsAt))}`
  if (banner.endsAt) return uit`Until ${formatDateTime(Date.parse(banner.endsAt))}`
  return ui("Always")
}

export function BannersSection() {
  const [draft, setDraft] = useState<BannerDraft>(EMPTY_BANNER_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const listQuery = useQuery({
    queryKey: ['admin-banners'],
    queryFn: () => apiRequest<{ data: Banner[] }>('/api/admin/banners'),
  })

  const update = (patch: Partial<BannerDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setSubmitError(null)
  }

  const reset = () => {
    setDraft(EMPTY_BANNER_DRAFT)
    setEditingId(null)
    setSubmitError(null)
  }

  const draftError = bannerDraftError(draft)
  // An empty message is the starting state, so only flag problems once there is something to fix.
  const visibleDraftError = draftError === 'content-required' ? null : draftError

  const save = async () => {
    if (draftError) return
    setSaving(true)
    try {
      const body = bannerInputFromDraft(draft)
      if (editingId) await apiRequest(`/api/admin/banners/${editingId}`, { method: 'PATCH', body })
      else await apiRequest('/api/admin/banners', { method: 'POST', body })
      reset()
      await listQuery.refetch()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : ui("Could not save the banner."))
    } finally {
      setSaving(false)
    }
  }

  const edit = (banner: Banner) => {
    setDraft(draftFromBanner(banner))
    setEditingId(banner.id)
    setSubmitError(null)
  }

  const remove = async (id: string) => {
    await apiRequest(`/api/admin/banners/${id}`, { method: 'DELETE' })
    if (editingId === id) reset()
    await listQuery.refetch()
  }

  const banners = listQuery.data?.data ?? []

  return (
    <div>
      <Section
        title={editingId ? ui("Edit banner") : ui("New banner")}
        hint={ui("Banners appear at the top of the app for every user while they are active. Links like [status page](https://example.com) or bare URLs become clickable.")}
      >
        <TextAreaField label={ui("Message")} value={draft.content} onChange={(content) => update({ content })} rows={2} />
        <SelectField
          width="w-32 sm:w-40"
          label={ui("Style")}
          value={draft.type}
          onChange={(type) => update({ type })}
          options={(['info', 'warning', 'error'] as const).map((type) => ({ value: type, label: typeLabel(type) }))}
        />
        <Toggle
          label={ui("Dismissible")}
          hint={ui("Users can hide the banner. Each device remembers the dismissal.")}
          checked={draft.dismissible}
          onChange={(dismissible) => update({ dismissible })}
        />
        <Field label={ui("Starts")} hint={ui("Leave empty to show it right away.")}>
          <Input type="datetime-local" className="w-56" value={draft.startsAt} onChange={(event) => update({ startsAt: event.target.value })} />
        </Field>
        <Field label={ui("Ends")} hint={ui("Leave empty to show it until it is deleted.")}>
          <Input type="datetime-local" className="w-56" value={draft.endsAt} onChange={(event) => update({ endsAt: event.target.value })} />
        </Field>
        {draft.content.trim() && (
          <div>
            <div className="mb-2 text-xs text-muted-foreground">{ui("Preview")}</div>
            <div className="rounded-lg bg-muted/50 p-4">
              <BannerCard type={draft.type} content={draft.content.trim()} onDismiss={draft.dismissible ? () => undefined : undefined} className="mx-auto max-w-2xl" />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(submitError ?? visibleDraftError) && (
            <p role="alert" className="mr-auto text-xs text-destructive">{submitError ?? draftErrorLabel(visibleDraftError!)}</p>
          )}
          {editingId && <Button size="sm" variant="ghost" onClick={reset}>{ui("Cancel")}</Button>}
          <Button size="sm" disabled={saving || draftError !== null} onClick={() => void save()}>
            {editingId ? null : <Plus />}
            {saving ? ui("Saving…") : editingId ? ui("Save changes") : ui("Create banner")}
          </Button>
        </div>
      </Section>

      <div className="mb-7 overflow-x-auto rounded-lg border">
        <table className="data-table">
          <thead className="border-b">
            <tr>
              <th className="px-3 py-2">{ui("Message")}</th>
              <th className="px-3 py-2">{ui("Style")}</th>
              <th className="px-3 py-2">{ui("Status")}</th>
              <th className="px-3 py-2">{ui("Schedule")}</th>
              <th className="px-3 py-2 text-right">{ui("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{ui("Loading banners…")}</td></tr>
            ) : banners.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{ui("No banners yet.")}</td></tr>
            ) : banners.map((banner) => (
              <tr key={banner.id} className={cn(editingId === banner.id && 'bg-accent/40')}>
                <td className="max-w-80 px-3 py-2"><div className="line-clamp-2 wrap-anywhere">{banner.content}</div></td>
                <td className="px-3 py-2 text-muted-foreground">{typeLabel(banner.type)}</td>
                <td className="px-3 py-2 text-muted-foreground">{statusLabel(bannerStatus(banner))}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{scheduleLabel(banner)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" title={ui("Edit")} onClick={() => edit(banner)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" title={ui("Delete")} className="text-destructive hover:text-destructive" onClick={() => void remove(banner.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
