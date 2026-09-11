import { useState } from 'react'
import { Check } from 'lucide-react'
import { createApiKeySchema } from '@pulpo/contracts'
import { useApiKeys } from '@/stores/apiKeys'
import { filterCodexModels, useCatalog } from '@/stores/catalog'
import type { ApiKey } from '@/lib/types'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ModelIcon } from '@/components/ModelIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckboxRow } from './misc'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const ALL_SCOPES = [
  { id: 'responses', label: 'Inference' },
  { id: 'models', label: 'List models' },
] as const

export function ApiKeySettingsDialog({ apiKey, onClose, onCreated }: {
  apiKey?: ApiKey
  onClose: () => void
  onCreated: (secret: string) => void
}) {
  const createKey = useApiKeys((state) => state.createKey)
  const updateKey = useApiKeys((state) => state.updateKey)
  const models = useCatalog((state) => state.models)
  const [name, setName] = useState(apiKey?.name ?? '')
  const [scopes, setScopes] = useState<string[]>(apiKey?.scopes ?? ['responses', 'models'])
  const [allModels, setAllModels] = useState(!apiKey?.allowedModels.length)
  const [selectedModels, setSelectedModels] = useState<string[]>(apiKey?.allowedModels ?? [])
  const [monthlyBudget, setMonthlyBudget] = useState(apiKey?.monthlyBudget?.toString() ?? '')
  const [totalBudget, setTotalBudget] = useState(apiKey?.totalBudget?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const selectableModels = filterCodexModels(models, false).filter((model) => model.enabled)
  const input = {
    name: name.trim() || (apiKey ? '' : 'untitled key'),
    scopes: scopes as ApiKey['scopes'],
    allowedModels: allModels ? [] : selectedModels,
    monthlyBudget: monthlyBudget === '' ? null : Number(monthlyBudget),
    totalBudget: totalBudget === '' ? null : Number(totalBudget),
  }
  const parsed = createApiKeySchema.safeParse({
    ...input,
    monthlyBudgetMicros: input.monthlyBudget === null ? null : Math.round(input.monthlyBudget * 1_000_000),
    lifetimeBudgetMicros: input.totalBudget === null ? null : Math.round(input.totalBudget * 1_000_000),
  })
  const invalidBudget = !parsed.success && parsed.error.issues.some((issue) => String(issue.path[0]).endsWith('BudgetMicros'))
  const canSave = parsed.success && (allModels || selectedModels.length > 0)

  const toggleModel = (id: string, on: boolean) => {
    setAllModels(false)
    setSelectedModels((current) => on ? [...new Set([...current, id])] : current.filter((value) => value !== id))
  }
  const submit = async () => {
    if (saving || !canSave) return
    setSaving(true)
    setFailed(false)
    try {
      if (apiKey) await updateKey(apiKey.id, input)
      else {
        const result = await createKey(input)
        onCreated(result.secret)
      }
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{apiKey ? ui('Edit API key') : ui('Create API key')}</DialogTitle>
          <DialogDescription>{apiKey ? ui('Update this key’s name, access, and spending limits.') : ui('The secret is shown exactly once. Store it somewhere safe.')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <fieldset disabled={saving} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">{ui("Name")}</Label>
              <Input
                id="key-name"
                placeholder={ui("e.g. laptop scripts")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{ui("Scopes")}</Label>
              <div className="space-y-1">
                {ALL_SCOPES.map((s) => (
                  <CheckboxRow
                    key={s.id}
                    label={ui(s.label)}
                    checked={scopes.includes(s.id)}
                    onChange={(v) =>
                      setScopes((cur) => (v ? [...cur, s.id] : cur.filter((x) => x !== s.id)))
                    }
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{ui("Model access")}</Label>
              <p className="text-xs text-muted-foreground"> {ui("Restrict this key to specific models, or allow every model.")} </p>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
                <CheckboxRow
                  label={ui("All models")}
                  checked={allModels}
                  onChange={(v) => {
                    setAllModels(v)
                    if (v) setSelectedModels([])
                  }}
                />
                <div className="mx-1 my-1 h-px bg-border" />
                {selectableModels.map((m) => {
                  const checked = !allModels && selectedModels.includes(m.id)
                  return (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm hover:bg-accent/60"
                    >
                      <button
                        type="button"
                        aria-label={m.name}
                        role="checkbox"
                        aria-checked={checked}
                        onClick={(e) => {
                          e.preventDefault()
                          toggleModel(m.id, !checked)
                        }}
                        className={cn(
                          'flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-transparent'
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </button>
                      <ModelIcon model={m} className="size-4" boxed={false} />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="text-[11px] text-muted-foreground">{m.provider}</span>
                    </label>
                  )
                })}
              </div>
              {!allModels && selectedModels.length === 0 && (
                <p className="text-xs text-destructive"> {ui("Select at least one model, or choose All models.")} </p>
              )}
              {!allModels && selectedModels.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {selectedModels.map((id) => {
                    const m = models.find((x) => x.id === id)
                    return (
                      <Badge key={id} variant="secondary" className="max-w-full gap-1 whitespace-normal font-normal">
                        {m && <ModelIcon model={m} className="size-3" boxed={false} />}
                        <span className="break-all">{m?.name ?? id}</span>
                        {!m && <span>{ui("Unavailable")}</span>}
                        <button
                          type="button"
                          className="ml-0.5 cursor-pointer opacity-60 hover:opacity-100"
                          onClick={() => toggleModel(id, false)}
                          aria-label={uit`Remove ${m?.name ?? id}`}
                        >
                          ×
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="key-budget-monthly">{ui("Monthly limit")}</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="key-budget-monthly"
                    type="number"
                    min="0.000001"
                    step="any"
                    placeholder={ui("none")}
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key-budget-total">{ui("All-time limit")}</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="key-budget-total"
                    type="number"
                    min="0.000001"
                    step="any"
                    placeholder={ui("none")}
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground"> {ui("Monthly resets each billing period. All-time is a lifetime cap for this key.")} </p>
          </fieldset>
          {invalidBudget && <p role="alert" className="text-sm text-destructive">{ui('Enter a positive spending limit, or leave it blank for no limit.')}</p>}
          {failed && <p role="alert" className="text-sm text-destructive">{ui('Could not save this key. Please try again.')}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{ui('Cancel')}</Button>
            <Button type="submit" disabled={saving || !canSave}>{saving ? ui('Saving…') : apiKey ? ui('Save') : ui('Create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
