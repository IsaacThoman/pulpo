import { useState } from 'react'
import { DEFAULT_DATA_RETENTION_TAGS, MAX_DATA_RETENTION_TAGS, type DataRetentionTag } from '@pulpo/contracts'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LucideIconSelect } from '@/components/admin/LucideIconSelect'
import { DataRetentionBadgeMark } from '@/components/chat/DataRetentionBadge'
import { resolvePresetIconName } from '@/components/chat/preset-icon-options'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

type Draft = DataRetentionTag & { isNew: boolean }

function newTagId(): string {
  return `tag-${crypto.randomUUID().slice(0, 8)}`
}

export function DataRetentionTagsEditor({
  tags,
  providerUsage,
  onSave,
}: {
  tags: DataRetentionTag[]
  /** Providers assigned to each tag, keyed by tag ID. */
  providerUsage: Map<string, number>
  onSave: (tags: DataRetentionTag[]) => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const colorValid = !!draft && HEX_COLOR.test(draft.color)
  const canSave = !!draft?.name.trim() && colorValid && !saving

  const save = async (next: DataRetentionTag[]) => {
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    if (!draft || !canSave) return
    const { isNew, ...tag } = draft
    const cleaned = { ...tag, name: tag.name.trim(), description: tag.description.trim() }
    await save(isNew ? [...tags, cleaned] : tags.map((existing) => existing.id === cleaned.id ? cleaned : existing))
    setDraft(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">{ui("Data retention tags")}</h3>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(DEFAULT_DATA_RETENTION_TAGS.map((tag) => ({ ...tag })))}>
          <RotateCcw /> {ui("Restore defaults")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || tags.length >= MAX_DATA_RETENTION_TAGS}
          onClick={() => setDraft({ id: newTagId(), name: '', description: '', icon: 'shield', color: '#64748b', isNew: true })}
        >
          <Plus /> {ui("Add tag")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{ui("Badges shown beside the provider on the new chat screen. Assign a default tag to each provider; individual models can override it.")}</p>
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="divide-y px-0 py-0">
          {tags.map((tag) => {
            const usage = providerUsage.get(tag.id) ?? 0
            return (
              <div key={tag.id} className="flex items-center gap-3 px-3 py-2.5">
                <DataRetentionBadgeMark tag={tag} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{tag.name}</div>
                  {tag.description && <div className="truncate text-xs text-muted-foreground">{tag.description}</div>}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {usage === 1 ? ui("1 provider") : ui("{{count}} providers", { count: usage })}
                </span>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon-sm" variant="ghost" title={ui("Edit tag")} disabled={saving} onClick={() => setDraft({ ...tag, isNew: false })}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title={ui("Delete tag")}
                    className="hover:text-destructive"
                    disabled={saving}
                    onClick={() => void save(tags.filter((existing) => existing.id !== tag.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
          {!tags.length && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">{ui("No data retention tags. Providers show no badge.")}</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.isNew ? ui("Add data retention tag") : ui("Edit data retention tag")}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3.5">
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <span>{ui("Preview")}</span>
                <DataRetentionBadgeMark tag={{ ...draft, color: colorValid ? draft.color : '#64748b' }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retention-tag-name">{ui("Name")}</Label>
                <Input
                  id="retention-tag-name"
                  value={draft.name}
                  maxLength={40}
                  placeholder={ui("Zero data retention")}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retention-tag-description">{ui("Description")}</Label>
                <Textarea
                  id="retention-tag-description"
                  rows={3}
                  value={draft.description}
                  maxLength={500}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{ui("Shown with the name when someone hovers over or taps the badge.")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{ui("Icon")}</Label>
                  <LucideIconSelect
                    value={resolvePresetIconName(draft.icon)}
                    ariaLabel={ui("Choose tag icon")}
                    onChange={(icon) => setDraft({ ...draft, icon: icon ?? 'shield' })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="retention-tag-color">{ui("Color")}</Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      aria-label={ui("Choose tag color")}
                      value={colorValid ? draft.color : '#64748b'}
                      onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                      className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                    />
                    <Input
                      id="retention-tag-color"
                      className={cn('h-8 font-mono text-xs', !colorValid && 'border-destructive')}
                      value={draft.color}
                      maxLength={7}
                      onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>{ui("Cancel")}</Button>
            <Button disabled={!canSave} onClick={() => void saveDraft()}>{draft?.isNew ? ui("Create") : ui("Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
