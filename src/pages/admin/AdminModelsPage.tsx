import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
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

interface AdminModel {
  id: string; providerConnectionId: string; labId: string | null; upstreamModelId: string
  name: string; description: string; enabled: boolean; contextWindow: number; maxOutputTokens: number
  executionMode: 'stream' | 'background'; tags: string[]; allowedParameters: string[]
  inputPriceMicros: number; cachedInputPriceMicros: number; outputPriceMicros: number; perRequestPriceMicros: number
  presets: unknown[]
}
interface Provider { id: string; name: string }
interface Lab { id: string; name: string }

const empty = (providerConnectionId = ''): AdminModel => ({
  id: '', providerConnectionId, labId: null, upstreamModelId: '', name: '', description: '', enabled: true,
  contextWindow: 128_000, maxOutputTokens: 16_384, executionMode: 'stream', tags: [], allowedParameters: [],
  inputPriceMicros: 0, cachedInputPriceMicros: 0, outputPriceMicros: 0, perRequestPriceMicros: 0,
  presets: [],
})

export function AdminModelsPage() {
  const [models, setModels] = useState<AdminModel[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [labs, setLabs] = useState<Lab[]>([])
  const [query, setQuery] = useState('')
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
  const filtered = useMemo(() => models.filter((model) => `${model.name} ${model.id} ${model.upstreamModelId}`.toLowerCase().includes(query.toLowerCase())), [models, query])

  const save = async () => {
    if (!draft) return
    const body = { ...draft, tags: draft.tags, allowedParameters: draft.allowedParameters }
    await apiRequest(creating ? '/api/admin/models' : `/api/admin/models/${draft.id}`, { method: creating ? 'POST' : 'PATCH', body })
    setDraft(null); await load(); await useCatalog.getState().load()
  }

  return <div className="space-y-4">
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold">Models</h2><Badge variant="secondary">{models.length}</Badge><div className="flex-1" />
      <Button size="sm" disabled={!providers.length} onClick={() => { setCreating(true); setDraft(empty(providers[0]?.id)) }}><Plus />New model</Button>
    </div>
    <div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="space-y-2">{filtered.map((model) => <Card key={model.id} className={!model.enabled ? 'opacity-60' : ''}><CardContent className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1"><div className="flex gap-2"><span className="font-medium">{model.name}</span><Badge variant="outline">{model.id}</Badge><Badge variant="secondary">{model.executionMode}</Badge></div><div className="mt-1 truncate text-xs text-muted-foreground">{model.description || model.upstreamModelId} · {formatNumber(model.contextWindow)} context</div></div>
      <Switch checked={model.enabled} onCheckedChange={(enabled) => void apiRequest(`/api/admin/models/${model.id}`, { method: 'PATCH', body: { enabled } }).then(load)} />
      <Button size="icon-sm" variant="ghost" onClick={() => { setCreating(false); setDraft({ ...model }) }}><Pencil /></Button>
      <Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={() => { if (confirm(`Delete ${model.name}?`)) void apiRequest(`/api/admin/models/${model.id}`, { method: 'DELETE' }).then(load) }}><Trash2 /></Button>
    </CardContent></Card>)}</div>
    <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{creating ? 'New model' : 'Edit model'}</DialogTitle></DialogHeader>
      {draft && <div className="grid grid-cols-2 gap-4">
        <Field label="Pulpo model ID"><Input value={draft.id} disabled={!creating} onChange={(e) => setDraft({ ...draft, id: e.target.value })} /></Field>
        <Field label="Display name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Provider"><Select value={draft.providerConnectionId} onValueChange={(value) => setDraft({ ...draft, providerConnectionId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Upstream model ID"><Input value={draft.upstreamModelId} onChange={(e) => setDraft({ ...draft, upstreamModelId: e.target.value })} /></Field>
        <Field label="Lab"><Select value={draft.labId ?? 'none'} onValueChange={(value) => setDraft({ ...draft, labId: value === 'none' ? null : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{labs.map((lab) => <SelectItem key={lab.id} value={lab.id}>{lab.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Execution"><Select value={draft.executionMode} onValueChange={(value: 'stream' | 'background') => setDraft({ ...draft, executionMode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="stream">Streaming</SelectItem><SelectItem value="background">Background</SelectItem></SelectContent></Select></Field>
        <Field label="Context window"><Input type="number" value={draft.contextWindow} onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) })} /></Field>
        <Field label="Maximum output tokens"><Input type="number" value={draft.maxOutputTokens} onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })} /></Field>
        <PriceField label="Input price (USD / 1M tokens)" valueMicros={draft.inputPriceMicros} onChange={(inputPriceMicros) => setDraft({ ...draft, inputPriceMicros })} />
        <PriceField label="Cached input price (USD / 1M tokens)" valueMicros={draft.cachedInputPriceMicros} onChange={(cachedInputPriceMicros) => setDraft({ ...draft, cachedInputPriceMicros })} />
        <PriceField label="Output price (USD / 1M tokens)" valueMicros={draft.outputPriceMicros} onChange={(outputPriceMicros) => setDraft({ ...draft, outputPriceMicros })} />
        <PriceField label="Per-request price (USD)" valueMicros={draft.perRequestPriceMicros} onChange={(perRequestPriceMicros) => setDraft({ ...draft, perRequestPriceMicros })} />
        <Field label="Tags (comma separated)"><Input value={draft.tags.join(', ')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></Field>
        <Field label="Allowed Responses parameters"><Input value={draft.allowedParameters.join(', ')} onChange={(e) => setDraft({ ...draft, allowedParameters: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></Field>
        <Field label="Description" className="col-span-2"><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        <Field label="Composer presets (JSON)" className="col-span-2"><PresetsEditor key={draft.id || 'new'} value={draft.presets} onChange={(presets) => setDraft({ ...draft, presets })} /></Field>
      </div>}
      <DialogFooter><Button onClick={() => void save()} disabled={!draft?.id || !draft?.name || !draft?.upstreamModelId || !draft.providerConnectionId}>Save</Button></DialogFooter>
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

function PresetsEditor({ value, onChange }: { value: unknown[]; onChange: (value: unknown[]) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState('')
  return <><Textarea className="min-h-40 font-mono text-xs" value={text} onChange={(event) => {
    setText(event.target.value)
    try {
      const parsed = JSON.parse(event.target.value)
      if (!Array.isArray(parsed)) throw new Error('Presets must be an array')
      setError(''); onChange(parsed)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid JSON') }
  }} />{error && <p className="text-xs text-destructive">{error}</p>}</>
}
