import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { chatPresetsSchema, type ChatPreset, type ChatPresetAction, type ChatPresetChoice, type ChatPresetIcon } from '@pulpo/contracts'
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCatalog } from '@/stores/catalog'
import { AI_ICONS, aiIconPath, isAiIconAvailable } from '@/lib/ai-icons'
import { PRESET_ICON_OPTIONS, PresetIcon } from '@/components/chat/PresetIcon'

interface AdminModel {
  id: string; providerConnectionId: string; labId: string | null; upstreamModelId: string
  name: string; description: string; enabled: boolean; visible: boolean; logo: string | null; systemPrompt: string; defaultParameters: Record<string, unknown>; interceptImagesWithOcr: boolean; contextWindow: number; maxOutputTokens: number
  executionMode: 'stream' | 'background'; tags: string[]; allowedParameters: string[]
  inputPriceMicros: number; cachedInputPriceMicros: number; outputPriceMicros: number; perRequestPriceMicros: number
  presets: ChatPreset[]
  fallbackModelId: string | null; maxRetries: number; retryDelaySeconds: number; stickyFallbackSeconds: number
  firstTokenTimeoutEnabled: boolean; firstTokenTimeoutSeconds: number; slowStickyEnabled: boolean; slowStickyMinTokensPerSecond: number; slowStickyMinCompletionSeconds: number
}
interface Provider { id: string; name: string }
interface Lab { id: string; name: string }

const empty = (providerConnectionId = '', labId: string | null = null): AdminModel => ({
  id: '', providerConnectionId, labId, upstreamModelId: '', name: '', description: '', enabled: true, visible: true, logo: 'openai', systemPrompt: '', defaultParameters: {}, interceptImagesWithOcr: false,
  contextWindow: 128_000, maxOutputTokens: 16_384, executionMode: 'stream', tags: [], allowedParameters: [],
  inputPriceMicros: 0, cachedInputPriceMicros: 0, outputPriceMicros: 0, perRequestPriceMicros: 0,
  presets: [],
  fallbackModelId: null, maxRetries: 0, retryDelaySeconds: 1, stickyFallbackSeconds: 0,
  firstTokenTimeoutEnabled: false, firstTokenTimeoutSeconds: 30, slowStickyEnabled: false, slowStickyMinTokensPerSecond: 5, slowStickyMinCompletionSeconds: 30,
})

export function AdminModelsPage() {
  const [models, setModels] = useState<AdminModel[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [labs, setLabs] = useState<Lab[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden' | 'enabled' | 'disabled'>('all')
  const [draft, setDraft] = useState<AdminModel | null>(null)
  const [creating, setCreating] = useState(false)
  const [presetEditorValid, setPresetEditorValid] = useState(true)

  const load = async () => {
    const [modelResult, providerResult, labResult] = await Promise.all([
      apiRequest<{ data: AdminModel[] }>('/api/admin/models'),
      apiRequest<{ data: Provider[] }>('/api/admin/providers'),
      apiRequest<{ data: Lab[] }>('/api/admin/labs'),
    ])
    setModels(modelResult.data); setProviders(providerResult.data); setLabs(labResult.data)
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { setPresetEditorValid(true) }, [draft?.id])
  const filtered = useMemo(() => models.filter((model) => `${model.name} ${model.id} ${model.upstreamModelId}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'visible' ? model.visible : filter === 'hidden' ? !model.visible : filter === 'enabled' ? model.enabled : !model.enabled))), [models, query, filter])
  const presetErrors = draft ? validatePresetDrafts(draft.presets, draft.id, draft.allowedParameters, models) : []

  const save = async () => {
    if (!draft) return
    const body = { ...draft, tags: draft.tags, allowedParameters: draft.allowedParameters }
    await apiRequest(creating ? '/api/admin/models' : `/api/admin/models/${draft.id}`, { method: creating ? 'POST' : 'PATCH', body })
    setDraft(null); await Promise.all([load(), useCatalog.getState().load()])
  }

  return <div className="space-y-4">
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold">Models</h2><Badge variant="secondary">{models.length}</Badge><div className="flex-1" />
      <Button size="sm" disabled={!providers.length || !labs.length} onClick={() => { setCreating(true); setDraft(empty(providers[0]?.id, labs.find((lab) => lab.name === 'Internal')?.id ?? labs[0]?.id ?? null)) }}><Plus />New model</Button>
    </div>
    <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={filter} onValueChange={(v: typeof filter) => setFilter(v)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{['all','visible','hidden','enabled','disabled'].map((v) => <SelectItem key={v} value={v}>{v[0]!.toUpperCase() + v.slice(1)}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-2">{filtered.map((model) => <Card key={model.id} className={!model.enabled ? 'opacity-60' : ''}><CardContent className="flex items-center gap-4 px-4 py-3">
      <img src={aiIconPath(model.logo ?? 'openai')} className="size-7 object-contain dark:invert" /><div className="min-w-0 flex-1"><div className="flex gap-2"><span className="font-medium">{model.name}</span><Badge variant="outline">{model.id}</Badge><Badge variant="secondary">{model.executionMode}</Badge>{!model.visible && <Badge variant="outline">hidden</Badge>}</div><div className="mt-1 truncate text-xs text-muted-foreground">{model.description || model.upstreamModelId} · {formatNumber(model.contextWindow)} context</div></div>
      <Switch checked={model.enabled} onCheckedChange={(enabled) => void apiRequest(`/api/admin/models/${model.id}`, { method: 'PATCH', body: { enabled } }).then(() => Promise.all([load(), useCatalog.getState().load()]))} />
      <Button size="icon-sm" variant="ghost" onClick={() => { setCreating(false); setDraft({ ...model }) }}><Pencil /></Button>
      <Button size="icon-sm" variant="ghost" title="Clone" onClick={() => { setCreating(true); setDraft({ ...model, id: `${model.id}-copy`, name: `${model.name} copy` }) }}><Copy /></Button>
      <Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={() => { if (confirm(`Delete ${model.name}?`)) void apiRequest(`/api/admin/models/${model.id}`, { method: 'DELETE' }).then(() => Promise.all([load(), useCatalog.getState().load()])) }}><Trash2 /></Button>
    </CardContent></Card>)}</div>
    <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{creating ? 'New model' : 'Edit model'}</DialogTitle></DialogHeader>
      {draft && <div className="grid grid-cols-2 gap-4">
        <Field label="Pulpo model ID"><Input value={draft.id} disabled={!creating} onChange={(e) => setDraft({ ...draft, id: e.target.value })} /></Field>
        <Field label="Display name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Provider"><Select value={draft.providerConnectionId} onValueChange={(value) => setDraft({ ...draft, providerConnectionId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Upstream model ID"><Input value={draft.upstreamModelId} onChange={(e) => setDraft({ ...draft, upstreamModelId: e.target.value })} /></Field>
        <Field label="Lab"><Select value={draft.labId ?? undefined} onValueChange={(value) => setDraft({ ...draft, labId: value })}><SelectTrigger><SelectValue placeholder="Select a lab" /></SelectTrigger><SelectContent>{labs.map((lab) => <SelectItem key={lab.id} value={lab.id}>{lab.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Model logo"><Select value={draft.logo ?? 'openai'} onValueChange={(logo) => setDraft({ ...draft, logo })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{AI_ICONS.filter((icon) => isAiIconAvailable(icon, 'model')).map((icon) => <SelectItem key={icon.id} value={icon.id}><span className="flex items-center gap-2"><img src={aiIconPath(icon.id)} className="size-4 object-contain dark:invert" />{icon.label}</span></SelectItem>)}</SelectContent></Select></Field>
        <Field label="Execution"><Select value={draft.executionMode} onValueChange={(value: 'stream' | 'background') => setDraft({ ...draft, executionMode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="stream">Streaming</SelectItem><SelectItem value="background">Background</SelectItem></SelectContent></Select></Field>
        <Field label="Context window"><Input type="number" value={draft.contextWindow} onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) })} /></Field>
        <Field label="Maximum output tokens"><Input type="number" value={draft.maxOutputTokens} onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })} /></Field>
        <PriceField label="Input price (USD / 1M tokens)" valueMicros={draft.inputPriceMicros} onChange={(inputPriceMicros) => setDraft({ ...draft, inputPriceMicros })} />
        <PriceField label="Cached input price (USD / 1M tokens)" valueMicros={draft.cachedInputPriceMicros} onChange={(cachedInputPriceMicros) => setDraft({ ...draft, cachedInputPriceMicros })} />
        <PriceField label="Output price (USD / 1M tokens)" valueMicros={draft.outputPriceMicros} onChange={(outputPriceMicros) => setDraft({ ...draft, outputPriceMicros })} />
        <PriceField label="Per-request price (USD)" valueMicros={draft.perRequestPriceMicros} onChange={(perRequestPriceMicros) => setDraft({ ...draft, perRequestPriceMicros })} />
        <Field label="Tags (comma separated)"><Input value={draft.tags.join(', ')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></Field>
        <Field label="Allowed Responses parameters"><Input value={draft.allowedParameters.join(', ')} onChange={(e) => setDraft({ ...draft, allowedParameters: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></Field>
        <Field label="Fallback model"><Select value={draft.fallbackModelId ?? 'none'} onValueChange={(value) => setDraft({ ...draft, fallbackModelId: value === 'none' ? null : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No fallback</SelectItem>{models.filter((m) => m.id !== draft.id && m.enabled).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Maximum retries"><Input type="number" min={0} max={10} value={draft.maxRetries} onChange={(e) => setDraft({ ...draft, maxRetries: Number(e.target.value) })} /></Field>
        <Field label="Retry delay (seconds)"><Input type="number" min={0} value={draft.retryDelaySeconds} onChange={(e) => setDraft({ ...draft, retryDelaySeconds: Number(e.target.value) })} /></Field>
        <Field label="Sticky fallback (seconds)"><Input type="number" min={0} value={draft.stickyFallbackSeconds} onChange={(e) => setDraft({ ...draft, stickyFallbackSeconds: Number(e.target.value) })} /></Field>
        <Field label="First-token timeout"><div className="flex items-center gap-3"><Switch checked={draft.firstTokenTimeoutEnabled} onCheckedChange={(v) => setDraft({ ...draft, firstTokenTimeoutEnabled: v })} /><Input type="number" min={1} disabled={!draft.firstTokenTimeoutEnabled} value={draft.firstTokenTimeoutSeconds} onChange={(e) => setDraft({ ...draft, firstTokenTimeoutSeconds: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">sec</span></div></Field>
        <Field label="Slow completion detection"><div className="flex items-center gap-3"><Switch checked={draft.slowStickyEnabled} onCheckedChange={(v) => setDraft({ ...draft, slowStickyEnabled: v })} /><Input type="number" min={0.1} step={0.1} disabled={!draft.slowStickyEnabled} value={draft.slowStickyMinTokensPerSecond} onChange={(e) => setDraft({ ...draft, slowStickyMinTokensPerSecond: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">min tok/s</span></div></Field>
        <Field label="Minimum slow duration"><Input type="number" min={1} disabled={!draft.slowStickyEnabled} value={draft.slowStickyMinCompletionSeconds} onChange={(e) => setDraft({ ...draft, slowStickyMinCompletionSeconds: Number(e.target.value) })} /></Field>
        <Field label="Availability"><div className="flex items-center gap-5 rounded-md border px-3 py-2"><label className="flex items-center gap-2 text-sm"><Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />Enabled</label><label className="flex items-center gap-2 text-sm"><Switch checked={draft.visible} onCheckedChange={(v) => setDraft({ ...draft, visible: v })} />Visible</label><label className="flex items-center gap-2 text-sm"><Switch checked={draft.interceptImagesWithOcr} onCheckedChange={(v) => setDraft({ ...draft, interceptImagesWithOcr: v })} />OCR images</label></div></Field>
        <Field label="Description" className="col-span-2"><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        <Field label="Model system prompt" className="col-span-2"><Textarea rows={4} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} /></Field>
        <Field label="Default custom parameters (JSON)" className="col-span-2"><JsonObjectEditor value={draft.defaultParameters} onChange={(defaultParameters) => setDraft({ ...draft, defaultParameters })} /></Field>
        <Field label="Composer presets" className="col-span-2"><PresetsEditor key={draft.id || 'new'} value={draft.presets} modelId={draft.id} models={models} allowedParameters={draft.allowedParameters} errors={presetErrors} onValidityChange={setPresetEditorValid} onChange={(presets) => setDraft({ ...draft, presets })} /></Field>
      </div>}
      <DialogFooter><Button onClick={() => void save()} disabled={!draft?.id || !draft?.name || !draft?.upstreamModelId || !draft.providerConnectionId || !draft.labId || presetErrors.length > 0 || !presetEditorValid}>Save</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}

function Field({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`space-y-1.5 ${className}`}><Label>{label}</Label>{children}</div>
}

function PriceField({ label, valueMicros, onChange }: { label: string; valueMicros: number; onChange: (valueMicros: number) => void }) {
  return <Field label={label}><div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
    <Input
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      className="pl-7 tabular-nums"
      value={valueMicros / 1_000_000}
      onChange={(event) => onChange(Math.round(Math.max(0, Number(event.target.value) || 0) * 1_000_000))}
    />
  </div></Field>
}

function JsonObjectEditor({ value, onChange, onValidityChange }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; onValidityChange?: (valid: boolean) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2)); const [error, setError] = useState('')
  return <><Textarea className="min-h-28 font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); try { const parsed = JSON.parse(e.target.value); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Must be a JSON object'); setError(''); onValidityChange?.(true); onChange(parsed) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid JSON'); onValidityChange?.(false) } }} />{error && <p className="text-xs text-destructive">{error}</p>}</>
}

function newPresetId(prefix: 'preset' | 'choice', used: Iterable<string>): string {
  const existing = new Set(used)
  let id = ''
  do id = `${prefix}-${crypto.randomUUID()}`
  while (existing.has(id))
  return id
}

function validatePresetDrafts(presets: ChatPreset[], modelId: string, allowedParameters: string[], models: AdminModel[]): string[] {
  const errors = chatPresetsSchema.safeParse(presets).error?.issues.map((issue) => issue.message) ?? []
  const allowed = new Set(allowedParameters)
  for (const preset of presets) {
    for (const choice of preset.choices) {
      if (choice.action.type === 'params') {
        for (const key of Object.keys(choice.action.params)) {
          if (!allowed.has(key)) errors.push(`${preset.name || 'Preset'} / ${choice.displayName || 'Choice'} uses parameter “${key}”, which is not allowed for this model.`)
        }
      }
      if (choice.action.type === 'redirect') {
        const targetModelId = choice.action.modelId
        const target = models.find((model) => model.id === targetModelId)
        if (targetModelId === modelId) errors.push(`${preset.name || 'Preset'} / ${choice.displayName || 'Choice'} cannot redirect to the same model.`)
        else if (!target?.enabled) errors.push(`${preset.name || 'Preset'} / ${choice.displayName || 'Choice'} must redirect to an enabled model.`)
      }
    }
  }
  return [...new Set(errors)]
}

function IconSelect({ value, allowDefault = false, onChange }: { value: ChatPresetIcon | null | undefined; allowDefault?: boolean; onChange: (value: ChatPresetIcon | null) => void }) {
  return <Select value={value ?? (allowDefault ? 'default' : 'circle')} onValueChange={(next) => onChange(next === 'default' ? null : next as ChatPresetIcon)}>
    <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
    <SelectContent>
      {allowDefault && <SelectItem value="default">Default icon</SelectItem>}
      {PRESET_ICON_OPTIONS.map((option) => <SelectItem key={option.id} value={option.id}><span className="flex items-center gap-2"><PresetIcon name={option.id} />{option.label}</span></SelectItem>)}
    </SelectContent>
  </Select>
}

function PresetsEditor({ value: presets, modelId, models, allowedParameters, errors, onValidityChange, onChange }: { value: ChatPreset[]; modelId: string; models: AdminModel[]; allowedParameters: string[]; errors: string[]; onValidityChange: (valid: boolean) => void; onChange: (value: ChatPreset[]) => void }) {
  const [invalidParameterEditors, setInvalidParameterEditors] = useState<Set<string>>(() => new Set())
  useEffect(() => { onValidityChange(invalidParameterEditors.size === 0) }, [invalidParameterEditors, onValidityChange])
  const setParameterEditorValidity = (id: string, valid: boolean) => setInvalidParameterEditors((current) => {
    const next = new Set(current)
    if (valid) next.delete(id)
    else next.add(id)
    return next
  })
  const update = (index: number, patch: Partial<ChatPreset>) => onChange(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Add model-specific controls to the chat composer. Choices can apply parameters, redirect to another model, or act as a labeled default.</p>
    {errors.length > 0 && <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"><ul className="list-disc space-y-1 pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
    {presets.map((preset, index) => <div key={`${preset.id}-${index}`} className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_12rem_auto] items-end gap-2"><div className="space-y-1.5"><Label className="text-xs">Preset name</Label><Input className="h-8" placeholder="e.g. Reasoning" value={preset.name} onChange={(e) => update(index, { name: e.target.value })} /></div><div className="space-y-1.5"><Label className="text-xs">Default icon</Label><IconSelect value={preset.icon} onChange={(icon) => update(index, { icon: icon ?? 'circle' })} /></div><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${preset.name || 'preset'}`} onClick={() => onChange(presets.filter((_, i) => i !== index))}><Trash2 /></Button></div>
      <div className="space-y-2">{preset.choices.map((choice, choiceIndex) => {
        const choices = (patch: Partial<ChatPresetChoice>) => update(index, { choices: preset.choices.map((item, i) => i === choiceIndex ? { ...item, ...patch } : item) })
        const parameterEditorId = `${preset.id}:${choice.id}`
        const setAction = (type: ChatPresetAction['type']) => { if (type !== 'params') setParameterEditorValidity(parameterEditorId, true); choices({ action: type === 'redirect' ? { type, modelId: '' } : type === 'params' ? { type, params: {} } : { type } }) }
        return <div key={choice.id} className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_10rem_9rem_auto] items-center gap-2"><Input className="h-8" placeholder="Display name" value={choice.displayName} onChange={(e) => choices({ displayName: e.target.value })} /><IconSelect value={choice.icon} allowDefault onChange={(icon) => choices({ icon })} /><Select value={choice.action.type} onValueChange={(type: ChatPresetAction['type']) => setAction(type)}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="params">Parameters</SelectItem><SelectItem value="redirect">Redirect</SelectItem></SelectContent></Select><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${choice.displayName || 'choice'}`} onClick={() => { setParameterEditorValidity(parameterEditorId, true); update(index, { choices: preset.choices.filter((_, i) => i !== choiceIndex), defaultChoiceId: preset.defaultChoiceId === choice.id ? null : preset.defaultChoiceId }) }}><Trash2 /></Button></div>
          {choice.action.type === 'none' && <p className="text-xs text-muted-foreground">No request override when selected.</p>}
          {choice.action.type === 'redirect' && <div className="space-y-1.5"><Label className="text-xs">Target model</Label><Select value={choice.action.modelId || undefined} onValueChange={(targetId) => choices({ action: { type: 'redirect', modelId: targetId } })}><SelectTrigger className="h-8"><SelectValue placeholder="Select an enabled model" /></SelectTrigger><SelectContent>{models.filter((model) => model.id !== modelId).map((model) => <SelectItem key={model.id} value={model.id} disabled={!model.enabled}>{model.name}{!model.enabled ? ' (disabled)' : ''}</SelectItem>)}</SelectContent></Select></div>}
          {choice.action.type === 'params' && <div className="space-y-1.5"><Label className="text-xs">Custom parameters (JSON object)</Label><JsonObjectEditor value={choice.action.params} onValidityChange={(valid) => setParameterEditorValidity(parameterEditorId, valid)} onChange={(params) => choices({ action: { type: 'params', params } })} />{allowedParameters.length > 0 && <p className="text-[11px] text-muted-foreground">Allowed: {allowedParameters.join(', ')}</p>}</div>}
        </div>
      })}</div>
      <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={preset.choices.length >= 20} onClick={() => { const id = newPresetId('choice', preset.choices.map((choice) => choice.id)); update(index, { choices: [...preset.choices, { id, displayName: 'New choice', icon: null, action: { type: 'none' } }] }) }}><Plus />Choice</Button><div className="ml-auto flex items-center gap-2"><Label className="text-xs">Default choice</Label><Select value={preset.defaultChoiceId ?? 'none'} onValueChange={(defaultChoiceId) => update(index, { defaultChoiceId: defaultChoiceId === 'none' ? null : defaultChoiceId })}><SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">First choice</SelectItem>{preset.choices.map((choice) => <SelectItem key={choice.id} value={choice.id}>{choice.displayName || 'Unnamed choice'}</SelectItem>)}</SelectContent></Select></div></div>
    </div>)}
    <Button type="button" variant="outline" size="sm" disabled={presets.length >= 10} onClick={() => { const presetId = newPresetId('preset', presets.map((preset) => preset.id)); const choiceId = newPresetId('choice', []); onChange([...presets, { id: presetId, name: 'New preset', icon: 'circle', defaultChoiceId: choiceId, choices: [{ id: choiceId, displayName: 'Default', icon: null, action: { type: 'none' } }] }]) }}><Plus />Add preset</Button>
    <details className="rounded-md border p-2"><summary className="cursor-pointer text-xs font-medium">JSON preview</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(presets, null, 2)}</pre></details>
  </div>
}
