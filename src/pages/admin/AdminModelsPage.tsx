import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Copy, Download, Eye, EyeOff, Link, Pencil, Plus, Search, Trash2 } from 'lucide-react'
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

interface AdminModel {
  id: string; providerConnectionId: string; labId: string | null; upstreamModelId: string
  name: string; description: string; enabled: boolean; visible: boolean; logo: string | null; systemPrompt: string; defaultParameters: Record<string, unknown>; interceptImagesWithOcr: boolean; contextWindow: number; maxOutputTokens: number
  executionMode: 'stream' | 'background'; tags: string[]; allowedParameters: string[]
  inputPriceMicros: number; cachedInputPriceMicros: number; outputPriceMicros: number; perRequestPriceMicros: number
  presets: unknown[]
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

  const load = async () => {
    const [modelResult, providerResult, labResult] = await Promise.all([
      apiRequest<{ data: AdminModel[] }>('/api/admin/models'),
      apiRequest<{ data: Provider[] }>('/api/admin/providers'),
      apiRequest<{ data: Lab[] }>('/api/admin/labs'),
    ])
    setModels(modelResult.data); setProviders(providerResult.data); setLabs(labResult.data)
  }
  useEffect(() => { void load() }, [])
  const filtered = useMemo(() => models.filter((model) => `${model.name} ${model.id} ${model.upstreamModelId}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'visible' ? model.visible : filter === 'hidden' ? !model.visible : filter === 'enabled' ? model.enabled : !model.enabled))), [models, query, filter])

  const patchModel = async (id: string, body: Record<string, unknown>) => { await apiRequest(`/api/admin/models/${id}`, { method: 'PATCH', body }); await Promise.all([load(), useCatalog.getState().load()]) }
  const exportModel = (model: AdminModel) => { const safe = { format: 'pulpo-model', version: 1, exportedAt: new Date().toISOString(), model }; const url = URL.createObjectURL(new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${model.id}.pulpo-model.json`; a.click(); URL.revokeObjectURL(url) }

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
      <Button size="icon-sm" variant="ghost" title={model.visible ? 'Hide' : 'Show'} onClick={() => void patchModel(model.id, { visible: !model.visible })}>{model.visible ? <EyeOff /> : <Eye />}</Button>
      <Button size="icon-sm" variant="ghost" title="Copy link" onClick={() => void navigator.clipboard.writeText(`${location.origin}/?model=${encodeURIComponent(model.id)}`)}><Link /></Button>
      <Button size="icon-sm" variant="ghost" title="Clone" onClick={() => { setCreating(true); setDraft({ ...model, id: `${model.id}-copy`, name: `${model.name} copy` }) }}><Copy /></Button>
      <Button size="icon-sm" variant="ghost" title="Export" onClick={() => exportModel(model)}><Download /></Button>
      <Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={() => { if (confirm(`Delete ${model.name}?`)) void apiRequest(`/api/admin/models/${model.id}`, { method: 'DELETE' }).then(() => Promise.all([load(), useCatalog.getState().load()])) }}><Trash2 /></Button>
    </CardContent></Card>)}</div>
    <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{creating ? 'New model' : 'Edit model'}</DialogTitle></DialogHeader>
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
        <Field label="Composer presets (JSON)" className="col-span-2"><PresetsEditor key={draft.id || 'new'} value={draft.presets} onChange={(presets) => setDraft({ ...draft, presets })} /></Field>
      </div>}
      <DialogFooter><Button onClick={() => void save()} disabled={!draft?.id || !draft?.name || !draft?.upstreamModelId || !draft.providerConnectionId || !draft.labId}>Save</Button></DialogFooter>
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

interface PresetChoice { id: string; displayName: string; icon?: string | null; action: { type: 'none' } | { type: 'redirect'; modelId: string } | { type: 'params'; params: Record<string, unknown> } }
interface PresetValue { id: string; name: string; icon: string; defaultChoiceId?: string | null; choices: PresetChoice[] }

function JsonObjectEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2)); const [error, setError] = useState('')
  return <><Textarea className="min-h-28 font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); try { const parsed = JSON.parse(e.target.value); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Must be a JSON object'); setError(''); onChange(parsed) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid JSON') } }} />{error && <p className="text-xs text-destructive">{error}</p>}</>
}

function PresetsEditor({ value, onChange }: { value: unknown[]; onChange: (value: unknown[]) => void }) {
  const presets = value as PresetValue[]
  const update = (index: number, patch: Partial<PresetValue>) => onChange(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  return <div className="space-y-3">
    {presets.map((preset, index) => <div key={`${preset.id}-${index}`} className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"><Input placeholder="Preset ID" value={preset.id} onChange={(e) => update(index, { id: e.target.value })} /><Input placeholder="Label" value={preset.name} onChange={(e) => update(index, { name: e.target.value })} /><Input placeholder="Icon (brain, zap…)" value={preset.icon} onChange={(e) => update(index, { icon: e.target.value })} /><Button variant="ghost" size="icon-sm" onClick={() => onChange(presets.filter((_, i) => i !== index))}><Trash2 /></Button></div>
      <div className="space-y-2">{preset.choices.map((choice, choiceIndex) => {
        const choices = (patch: Partial<PresetChoice>) => update(index, { choices: preset.choices.map((item, i) => i === choiceIndex ? { ...item, ...patch } : item) })
        return <div key={`${choice.id}-${choiceIndex}`} className="grid grid-cols-[1fr_1fr_8rem_1fr_auto] items-start gap-2 rounded-md bg-muted/40 p-2"><Input placeholder="Choice ID" value={choice.id} onChange={(e) => choices({ id: e.target.value })} /><Input placeholder="Display name" value={choice.displayName} onChange={(e) => choices({ displayName: e.target.value })} /><Select value={choice.action.type} onValueChange={(type: 'none' | 'redirect' | 'params') => choices({ action: type === 'redirect' ? { type, modelId: '' } : type === 'params' ? { type, params: {} } : { type } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="redirect">Redirect</SelectItem><SelectItem value="params">Parameters</SelectItem></SelectContent></Select>{choice.action.type === 'redirect' ? <Input placeholder="Target model ID" value={choice.action.modelId} onChange={(e) => choices({ action: { type: 'redirect', modelId: e.target.value } })} /> : choice.action.type === 'params' ? <JsonObjectEditor value={choice.action.params} onChange={(params) => choices({ action: { type: 'params', params } })} /> : <span className="px-2 py-2 text-xs text-muted-foreground">No override</span>}<Button variant="ghost" size="icon-sm" onClick={() => update(index, { choices: preset.choices.filter((_, i) => i !== choiceIndex) })}><Trash2 /></Button></div>
      })}</div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => update(index, { choices: [...preset.choices, { id: `choice-${preset.choices.length + 1}`, displayName: 'New choice', action: { type: 'none' } }] })}><Plus />Choice</Button><Select value={preset.defaultChoiceId ?? 'none'} onValueChange={(defaultChoiceId) => update(index, { defaultChoiceId: defaultChoiceId === 'none' ? null : defaultChoiceId })}><SelectTrigger className="w-48"><SelectValue placeholder="Default choice" /></SelectTrigger><SelectContent><SelectItem value="none">No default</SelectItem>{preset.choices.map((choice) => <SelectItem key={choice.id} value={choice.id}>{choice.displayName}</SelectItem>)}</SelectContent></Select></div>
    </div>)}
    <Button variant="outline" size="sm" onClick={() => onChange([...presets, { id: `preset-${presets.length + 1}`, name: 'New preset', icon: 'circle', defaultChoiceId: null, choices: [{ id: 'default', displayName: 'Default', action: { type: 'none' } }] }])}><Plus />Add preset</Button>
    <details className="rounded-md border p-2"><summary className="cursor-pointer text-xs font-medium">JSON preview</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(presets, null, 2)}</pre></details>
  </div>
}
