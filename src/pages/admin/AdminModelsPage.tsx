import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { chatPresetsSchema, type ChatPreset, type ChatPresetAction, type ChatPresetChoice, type ChatPresetIcon } from '@pulpo/contracts'
import { Check, ChevronRight, Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCatalog } from '@/stores/catalog'
import { AI_ICONS, isAiIconAvailable, type AiIconKind } from '@/lib/ai-icons'
import { AiLogo } from '@/components/ProviderLogo'
import { PRESET_ICON_OPTIONS, PresetIcon } from '@/components/chat/PresetIcon'

interface AdminModel {
  id: string
  providerConnectionId: string
  labId: string | null
  upstreamModelId: string
  name: string
  description: string
  enabled: boolean
  visible: boolean
  logo: string | null
  systemPrompt: string
  defaultParameters: Record<string, unknown>
  interceptImagesWithOcr: boolean
  contextWindow: number
  maxOutputTokens: number
  executionMode: 'stream' | 'background'
  tags: string[]
  allowedParameters: string[]
  inputPriceMicros: number
  cachedInputPriceMicros: number
  outputPriceMicros: number
  perRequestPriceMicros: number
  presets: ChatPreset[]
  fallbackModelId: string | null
  maxRetries: number
  retryDelaySeconds: number
  stickyFallbackSeconds: number
  firstTokenTimeoutEnabled: boolean
  firstTokenTimeoutSeconds: number
  slowStickyEnabled: boolean
  slowStickyMinTokensPerSecond: number
  slowStickyMinCompletionSeconds: number
}
interface Provider { id: string; name: string; baseUrl?: string }
interface Lab { id: string; name: string; logo?: string }

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
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden' | 'enabled' | 'disabled'>('visible')
  const [draft, setDraft] = useState<AdminModel | null>(null)
  const [creating, setCreating] = useState(false)
  const [presetEditorValid, setPresetEditorValid] = useState(true)
  const [paramsValid, setParamsValid] = useState(true)

  const load = async () => {
    const [modelResult, providerResult, labResult] = await Promise.all([
      apiRequest<{ data: AdminModel[] }>('/api/admin/models'),
      apiRequest<{ data: Provider[] }>('/api/admin/providers'),
      apiRequest<{ data: Lab[] }>('/api/admin/labs'),
    ])
    setModels(modelResult.data); setProviders(providerResult.data); setLabs(labResult.data)
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { setPresetEditorValid(true); setParamsValid(true) }, [draft?.id])
  const filtered = useMemo(() => models.filter((model) => `${model.name} ${model.id} ${model.upstreamModelId}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'visible' ? model.visible : filter === 'hidden' ? !model.visible : filter === 'enabled' ? model.enabled : !model.enabled))), [models, query, filter])
  const presetErrors = draft ? validatePresetDrafts(draft.presets, draft.id, draft.allowedParameters, models) : []

  const save = async () => {
    if (!draft) return
    const body = { ...draft, tags: draft.tags, allowedParameters: draft.allowedParameters }
    await apiRequest(creating ? '/api/admin/models' : `/api/admin/models/${draft.id}`, { method: creating ? 'POST' : 'PATCH', body })
    setDraft(null); await Promise.all([load(), useCatalog.getState().load()])
  }

  const canSave = !!draft?.id && !!draft?.name && !!draft?.upstreamModelId && !!draft.providerConnectionId && !!draft.labId && presetErrors.length === 0 && presetEditorValid && paramsValid

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Models</h2>
        <Badge variant="secondary">{models.length}</Badge>
        <div className="flex-1" />
        <Button
          size="sm"
          disabled={!providers.length || !labs.length}
          onClick={() => {
            setCreating(true)
            setDraft(empty(providers[0]?.id, labs.find((lab) => lab.name === 'Internal')?.id ?? labs[0]?.id ?? null))
          }}
        >
          <Plus />
          New model
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select value={filter} onValueChange={(v: typeof filter) => setFilter(v)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['visible', 'hidden', 'all', 'enabled', 'disabled'] as const).map((v) => (
              <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.map((model) => (
          <Card key={model.id} className={cn('shadow-none', !model.enabled && 'opacity-55')}>
            <CardContent className="flex items-center gap-4 px-4 py-3">
              <AiLogo icon={model.logo ?? 'openai'} className="size-8 rounded-[4px]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{model.name}</span>
                  <Badge variant="outline" className="font-normal">{model.id}</Badge>
                  <Badge variant="secondary" className="font-normal">{model.executionMode}</Badge>
                  {!model.visible && <Badge variant="secondary" className="font-normal">hidden</Badge>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {model.description || model.upstreamModelId} · {formatNumber(model.contextWindow)} ctx
                </div>
              </div>
              <Button size="icon-sm" variant="ghost" title="Edit" onClick={() => { setCreating(false); setDraft({ ...model }) }}>
                <Pencil className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" title="Clone" onClick={() => { setCreating(true); setDraft({ ...model, id: `${model.id}-copy`, name: `${model.name} copy` }) }}>
                <Copy className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="hover:text-destructive"
                title="Delete"
                onClick={() => {
                  if (confirm(`Delete ${model.name}?`)) {
                    void apiRequest(`/api/admin/models/${model.id}`, { method: 'DELETE' }).then(() => Promise.all([load(), useCatalog.getState().load()]))
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
              <Switch
                checked={model.enabled}
                onCheckedChange={(enabled) => void apiRequest(`/api/admin/models/${model.id}`, { method: 'PATCH', body: { enabled } }).then(() => Promise.all([load(), useCatalog.getState().load()]))}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="flex h-[720px] max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2.5">
              {draft && <AiLogo icon={draft.logo ?? 'openai'} className="size-6 rounded-[3px]" />}
              {creating ? 'New model' : 'Edit model'}
              {draft?.id && <Badge variant="outline" className="font-mono font-normal">{draft.id}</Badge>}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <ScrollArea className="min-h-0 flex-1">
              <ModelEditorBody
                key={creating ? `new-${draft.id}` : draft.id}
                draft={draft}
                setDraft={setDraft}
                creating={creating}
                providers={providers}
                labs={labs}
                models={models}
                presetErrors={presetErrors}
                onPresetValidityChange={setPresetEditorValid}
                onParamsValidityChange={setParamsValid}
              />
            </ScrollArea>
          )}

          <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => void save()}>Save & update</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ModelEditorBody({
  draft,
  setDraft,
  creating,
  providers,
  labs,
  models,
  presetErrors,
  onPresetValidityChange,
  onParamsValidityChange,
}: {
  draft: AdminModel
  setDraft: (draft: AdminModel) => void
  creating: boolean
  providers: Provider[]
  labs: Lab[]
  models: AdminModel[]
  presetErrors: string[]
  onPresetValidityChange: (valid: boolean) => void
  onParamsValidityChange: (valid: boolean) => void
}) {
  const [jsonOpen, setJsonOpen] = useState(false)
  const selectedProvider = providers.find((provider) => provider.id === draft.providerConnectionId)
  const selectedLab = labs.find((lab) => lab.id === draft.labId)
  const stickySeconds = draft.stickyFallbackSeconds
  const retryEnabled =
    draft.maxRetries > 0 ||
    !!draft.fallbackModelId ||
    draft.firstTokenTimeoutEnabled ||
    draft.slowStickyEnabled

  const setRetryEnabled = (enabled: boolean) => {
    if (enabled) {
      setDraft({
        ...draft,
        maxRetries: draft.maxRetries > 0 ? draft.maxRetries : 3,
        retryDelaySeconds: draft.retryDelaySeconds || 2,
        stickyFallbackSeconds: draft.stickyFallbackSeconds || 60,
      })
      return
    }
    setDraft({
      ...draft,
      fallbackModelId: null,
      maxRetries: 0,
      firstTokenTimeoutEnabled: false,
      slowStickyEnabled: false,
    })
  }

  return (
    <div className="space-y-5 px-6 py-5">
      <div className="grid grid-cols-2 gap-4">
        <LabPickerTile
          labs={labs}
          value={draft.labId}
          onChange={(labId) => setDraft({ ...draft, labId })}
        />
        <LogoPickerTile
          label="Model logo"
          helper="Product mark used in chat, favorites, and model lists."
          kind="model"
          value={draft.logo ?? 'openai'}
          onChange={(logo) => setDraft({ ...draft, logo })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Model name">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Model ID">
          <Input
            value={draft.id}
            disabled={!creating}
            className="font-mono text-xs"
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Description</Label>
        <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ToggleRow label="Enabled" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
        <ToggleRow label="Visible in picker" checked={draft.visible} onChange={(visible) => setDraft({ ...draft, visible })} />
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="text-sm font-medium">Upstream</div>
        <Field label="Provider">
          <Select value={draft.providerConnectionId} onValueChange={(providerConnectionId) => setDraft({ ...draft, providerConnectionId })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select provider" /></SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {selectedProvider && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="text-xs font-medium">{selectedProvider.name}</div>
            {selectedProvider.baseUrl && (
              <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {selectedProvider.baseUrl}
              </code>
            )}
            {selectedLab && (
              <div className="mt-1 text-[11px] text-muted-foreground">Lab: {selectedLab.name}</div>
            )}
          </div>
        )}
        <Field label="Upstream model">
          <Input
            className="font-mono text-xs"
            value={draft.upstreamModelId}
            onChange={(e) => setDraft({ ...draft, upstreamModelId: e.target.value })}
            placeholder="Select or type model name"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Execution">
            <Select value={draft.executionMode} onValueChange={(executionMode: 'stream' | 'background') => setDraft({ ...draft, executionMode })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stream">Streaming</SelectItem>
                <SelectItem value="background">Background</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Context window">
            <Input type="number" min={1} className="tabular-nums" value={draft.contextWindow} onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) })} />
          </Field>
          <Field label="Max output tokens">
            <Input type="number" min={1} className="tabular-nums" value={draft.maxOutputTokens} onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })} />
          </Field>
          <Field label="Tags">
            <Input value={draft.tags.join(', ')} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="reasoning, vision" />
          </Field>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="text-sm font-medium">Pricing</div>
        <div className="grid grid-cols-3 gap-3">
          <PriceField label="Input $/M tokens" valueMicros={draft.inputPriceMicros} onChange={(inputPriceMicros) => setDraft({ ...draft, inputPriceMicros })} />
          <PriceField label="Cached $/M tokens" valueMicros={draft.cachedInputPriceMicros} onChange={(cachedInputPriceMicros) => setDraft({ ...draft, cachedInputPriceMicros })} />
          <PriceField label="Output $/M tokens" valueMicros={draft.outputPriceMicros} onChange={(outputPriceMicros) => setDraft({ ...draft, outputPriceMicros })} />
        </div>
        <PriceField label="Per-request $" valueMicros={draft.perRequestPriceMicros} onChange={(perRequestPriceMicros) => setDraft({ ...draft, perRequestPriceMicros })} />
        <Field label="Allowed Responses parameters">
          <Input
            value={draft.allowedParameters.join(', ')}
            onChange={(e) => setDraft({ ...draft, allowedParameters: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
            placeholder="temperature, reasoning_effort"
          />
        </Field>
        <Field label="Custom parameters (JSON)">
          <JsonObjectEditor
            value={draft.defaultParameters}
            onValidityChange={onParamsValidityChange}
            onChange={(defaultParameters) => setDraft({ ...draft, defaultParameters })}
          />
        </Field>
      </div>

      <Separator />

      <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <ToggleRow label="Enable retry on failure" checked={retryEnabled} onChange={setRetryEnabled} />
        {retryEnabled && (
          <div className="space-y-3 pt-1">
            <Field label="Fallback model">
              <Select
                value={draft.fallbackModelId ?? '__same__'}
                onValueChange={(value) => setDraft({ ...draft, fallbackModelId: value === '__same__' ? null : value })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__same__">Same model ({draft.name || draft.id || 'current'}) — retry on current</SelectItem>
                  {models.filter((model) => model.id !== draft.id && model.enabled).map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max retries">
                <Input type="number" min={1} max={10} className="tabular-nums" value={draft.maxRetries || 1} onChange={(e) => setDraft({ ...draft, maxRetries: Number(e.target.value) })} />
              </Field>
              <Field label="Retry delay (sec)">
                <Input type="number" min={0} max={300} className="tabular-nums" value={draft.retryDelaySeconds} onChange={(e) => setDraft({ ...draft, retryDelaySeconds: Number(e.target.value) })} />
              </Field>
              <Field label="Sticky block (sec)">
                <Input type="number" min={0} max={3600} className="tabular-nums" value={draft.stickyFallbackSeconds} onChange={(e) => setDraft({ ...draft, stickyFallbackSeconds: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ToggleRow
                label="Fallback if no first streamed token arrives in time"
                checked={draft.firstTokenTimeoutEnabled}
                onChange={(firstTokenTimeoutEnabled) => setDraft({ ...draft, firstTokenTimeoutEnabled })}
              />
              <Field label="First token timeout (sec)">
                <Input
                  type="number"
                  min={1}
                  max={300}
                  className="tabular-nums"
                  value={draft.firstTokenTimeoutSeconds}
                  disabled={!draft.firstTokenTimeoutEnabled}
                  onChange={(e) => setDraft({ ...draft, firstTokenTimeoutSeconds: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="space-y-3">
              <ToggleRow
                label="Sticky-block slow completions"
                checked={draft.slowStickyEnabled}
                onChange={(slowStickyEnabled) => setDraft({ ...draft, slowStickyEnabled })}
                disabled={stickySeconds <= 0}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min avg output tok/sec">
                  <Input
                    type="number"
                    min={0.1}
                    max={1000}
                    step={0.1}
                    className="tabular-nums"
                    value={draft.slowStickyMinTokensPerSecond}
                    disabled={!draft.slowStickyEnabled || stickySeconds <= 0}
                    onChange={(e) => setDraft({ ...draft, slowStickyMinTokensPerSecond: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Min completion time (sec)">
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    className="tabular-nums"
                    value={draft.slowStickyMinCompletionSeconds}
                    disabled={!draft.slowStickyEnabled || stickySeconds <= 0}
                    onChange={(e) => setDraft({ ...draft, slowStickyMinCompletionSeconds: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              If “Same model” is selected, retries use the current model. Sticky block temporarily routes to fallback without attempting the primary. First-token timeout applies to streamed requests only. Slow sticky blocking requires sticky block &gt; 0.
            </p>
          </div>
        )}
      </div>

      <ToggleRow
        label="Enable OCR for images"
        checked={draft.interceptImagesWithOcr}
        onChange={(interceptImagesWithOcr) => setDraft({ ...draft, interceptImagesWithOcr })}
      />

      <Separator />

      <div className="space-y-1.5">
        <Label className="text-xs">System prompt</Label>
        <Textarea
          rows={3}
          placeholder="You are a helpful assistant."
          value={draft.systemPrompt}
          onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
        />
      </div>

      <PresetsEditor
        key={draft.id || 'new'}
        value={draft.presets}
        modelId={draft.id}
        models={models}
        allowedParameters={draft.allowedParameters}
        errors={presetErrors}
        onValidityChange={onPresetValidityChange}
        onChange={(presets) => setDraft({ ...draft, presets })}
      />

      <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
        <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
          <ChevronRight className={cn('size-4 transition-transform', jsonOpen && 'rotate-90')} />
          JSON preview
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(
              {
                id: draft.id,
                name: draft.name,
                provider_id: draft.providerConnectionId,
                lab_id: draft.labId,
                upstream_model_name: draft.upstreamModelId,
                input_cost_per_million: draft.inputPriceMicros / 1_000_000,
                cached_input_cost_per_million: draft.cachedInputPriceMicros / 1_000_000,
                output_cost_per_million: draft.outputPriceMicros / 1_000_000,
                per_request_cost: draft.perRequestPriceMicros / 1_000_000,
                custom_params: draft.defaultParameters,
                fallback_enabled: retryEnabled,
                fallback_model_id: draft.fallbackModelId,
                max_retries: draft.maxRetries,
                fallback_delay_seconds: draft.retryDelaySeconds,
                sticky_fallback_seconds: draft.stickyFallbackSeconds,
                first_token_timeout_enabled: draft.firstTokenTimeoutEnabled,
                first_token_timeout_seconds: draft.firstTokenTimeoutSeconds,
                slow_sticky_enabled: draft.slowStickyEnabled,
                slow_sticky_min_tokens_per_second: draft.slowStickyMinTokensPerSecond,
                slow_sticky_min_completion_seconds: draft.slowStickyMinCompletionSeconds,
                intercept_images_with_ocr: draft.interceptImagesWithOcr,
                meta: {
                  model_logo: draft.logo,
                  description: draft.description,
                  enabled: draft.enabled,
                  visible: draft.visible,
                  system_prompt: draft.systemPrompt,
                  chat_options: { presets: draft.presets },
                },
              },
              null,
              2,
            )}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function LogoPickerTile({
  label,
  helper,
  kind,
  value,
  onChange,
}: {
  label: string
  helper: string
  kind: AiIconKind
  value: string
  onChange: (value: string) => void
}) {
  const options = AI_ICONS.filter(
    (icon) => isAiIconAvailable(icon, kind) && (kind !== 'lab' || !icon.color),
  )
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group/tile relative mt-1.5 flex aspect-[2/1] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-muted/25 transition-colors hover:bg-accent"
          >
            <AiLogo icon={value} className="size-14 transition-transform duration-150 group-hover/tile:scale-105" />
            <Badge variant="secondary" className="absolute bottom-2 right-2 font-normal">{kind}</Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[336px] overflow-y-auto p-2"
        >
          <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
            {kind === 'lab' ? 'Choose an associated lab' : 'Choose a model logo'}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {options.map((icon) => (
              <button
                key={icon.id}
                type="button"
                onClick={() => onChange(icon.id)}
                className={cn(
                  'relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md p-2 text-[10px] transition-colors hover:bg-accent',
                  value === icon.id && 'bg-accent ring-1 ring-border',
                )}
                title={`${icon.label}${icon.color ? ' · color' : ' · monochrome'}`}
              >
                <AiLogo icon={icon.id} className="size-7" />
                <span className="w-full truncate">{icon.label}</span>
                {value === icon.id && <Check className="absolute right-1 top-1 size-3 text-primary" />}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{helper}</p>
    </div>
  )
}

function LabPickerTile({
  labs,
  value,
  onChange,
}: {
  labs: Lab[]
  value: string | null
  onChange: (labId: string) => void
}) {
  const selected = labs.find((lab) => lab.id === value)
  return (
    <div>
      <Label className="text-xs">Associated lab</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group/tile relative mt-1.5 flex aspect-[2/1] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-muted/25 transition-colors hover:bg-accent"
          >
            <AiLogo
              icon={selected?.logo || 'pulpo'}
              className="size-14 transition-transform duration-150 group-hover/tile:scale-105"
            />
            <Badge variant="secondary" className="absolute bottom-2 right-2 font-normal">lab</Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[336px] overflow-y-auto p-2"
        >
          <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">Choose an associated lab</div>
          <div className="grid grid-cols-4 gap-1">
            {labs.map((lab) => (
              <button
                key={lab.id}
                type="button"
                onClick={() => onChange(lab.id)}
                className={cn(
                  'relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md p-2 text-[10px] transition-colors hover:bg-accent',
                  value === lab.id && 'bg-accent ring-1 ring-border',
                )}
                title={lab.name}
              >
                <AiLogo icon={lab.logo || 'pulpo'} className="size-7" />
                <span className="w-full truncate">{lab.name}</span>
                {value === lab.id && <Check className="absolute right-1 top-1 size-3 text-primary" />}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Monochrome company mark used in the model picker.
      </p>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-md py-1 text-sm',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

function PriceField({ label, valueMicros, onChange }: { label: string; valueMicros: number; onChange: (valueMicros: number) => void }) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        className="tabular-nums"
        value={valueMicros / 1_000_000}
        onChange={(event) => onChange(Math.round(Math.max(0, Number(event.target.value) || 0) * 1_000_000))}
      />
    </Field>
  )
}

function JsonObjectEditor({
  value,
  onChange,
  onValidityChange,
  compact,
}: {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  onValidityChange?: (valid: boolean) => void
  compact?: boolean
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, compact ? 0 : 2))
  const [error, setError] = useState('')
  return (
    <>
      {compact ? (
        <Input
          className="h-8 font-mono text-xs"
          value={text}
          placeholder="{}"
          onChange={(e) => {
            setText(e.target.value)
            try {
              const parsed = JSON.parse(e.target.value || '{}')
              if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Must be a JSON object')
              setError('')
              onValidityChange?.(true)
              onChange(parsed)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Invalid JSON')
              onValidityChange?.(false)
            }
          }}
        />
      ) : (
        <Textarea
          rows={3}
          className="font-mono text-xs"
          value={text}
          placeholder='{"temperature": 0.7}'
          onChange={(e) => {
            setText(e.target.value)
            try {
              const parsed = JSON.parse(e.target.value)
              if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Must be a JSON object')
              setError('')
              onValidityChange?.(true)
              onChange(parsed)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Invalid JSON')
              onValidityChange?.(false)
            }
          }}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  )
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

function IconSelect({
  value,
  allowDefault = false,
  onChange,
}: {
  value: ChatPresetIcon | null | undefined
  allowDefault?: boolean
  onChange: (value: ChatPresetIcon | null) => void
}) {
  return (
    <Select
      value={value ?? (allowDefault ? '__none__' : 'circle')}
      onValueChange={(next) => onChange(next === '__none__' ? null : next as ChatPresetIcon)}
    >
      <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Icon" /></SelectTrigger>
      <SelectContent>
        {allowDefault && <SelectItem value="__none__">Default</SelectItem>}
        {PRESET_ICON_OPTIONS.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <span className="flex items-center gap-2">
              <PresetIcon name={option.id} />
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PresetsEditor({
  value: presets,
  modelId,
  models,
  allowedParameters,
  errors,
  onValidityChange,
  onChange,
}: {
  value: ChatPreset[]
  modelId: string
  models: AdminModel[]
  allowedParameters: string[]
  errors: string[]
  onValidityChange: (valid: boolean) => void
  onChange: (value: ChatPreset[]) => void
}) {
  const [invalidParameterEditors, setInvalidParameterEditors] = useState<Set<string>>(() => new Set())
  useEffect(() => { onValidityChange(invalidParameterEditors.size === 0) }, [invalidParameterEditors, onValidityChange])
  const setParameterEditorValidity = (id: string, valid: boolean) => setInvalidParameterEditors((current) => {
    const next = new Set(current)
    if (valid) next.delete(id)
    else next.add(id)
    return next
  })
  const update = (index: number, patch: Partial<ChatPreset>) => onChange(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Chat presets</Label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Generic composer controls. Each choice can do nothing, override custom params, or redirect to another model.
        </p>
      </div>
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <ul className="list-disc space-y-1 pl-4">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}
      <div className="space-y-4">
        {presets.map((preset, index) => (
          <div key={preset.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                <Field label="Preset name">
                  <Input
                    className="h-8"
                    placeholder="e.g. Reasoning"
                    value={preset.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                  />
                </Field>
                <Field label="Default icon">
                  <IconSelect value={preset.icon} onChange={(icon) => update(index, { icon: icon ?? 'circle' })} />
                </Field>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mt-6"
                aria-label={`Remove ${preset.name || 'preset'}`}
                onClick={() => onChange(presets.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Choices</div>
              {preset.choices.map((choice, choiceIndex) => {
                const patchChoice = (patch: Partial<ChatPresetChoice>) =>
                  update(index, { choices: preset.choices.map((item, i) => i === choiceIndex ? { ...item, ...patch } : item) })
                const parameterEditorId = `${preset.id}:${choice.id}`
                const setAction = (type: ChatPresetAction['type']) => {
                  if (type !== 'params') setParameterEditorValidity(parameterEditorId, true)
                  patchChoice({
                    action:
                      type === 'redirect' ? { type, modelId: '' }
                        : type === 'params' ? { type, params: {} }
                          : { type },
                  })
                }
                return (
                  <div key={choice.id} className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                    <div className="grid grid-cols-[1fr_120px_32px] gap-2">
                      <Input
                        className="h-8"
                        placeholder="Display name"
                        value={choice.displayName}
                        onChange={(e) => patchChoice({ displayName: e.target.value })}
                      />
                      <IconSelect value={choice.icon} allowDefault onChange={(icon) => patchChoice({ icon })} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${choice.displayName || 'choice'}`}
                        onClick={() => {
                          setParameterEditorValidity(parameterEditorId, true)
                          update(index, {
                            choices: preset.choices.filter((_, i) => i !== choiceIndex),
                            defaultChoiceId: preset.defaultChoiceId === choice.id ? null : preset.defaultChoiceId,
                          })
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2">
                      <Select value={choice.action.type} onValueChange={(type: ChatPresetAction['type']) => setAction(type)}>
                        <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="redirect">Redirect</SelectItem>
                          <SelectItem value="params">Custom params</SelectItem>
                        </SelectContent>
                      </Select>
                      {choice.action.type === 'none' && (
                        <div className="flex h-8 items-center text-xs text-muted-foreground">
                          No override when selected
                        </div>
                      )}
                      {choice.action.type === 'redirect' && (
                        <Select
                          value={choice.action.modelId || undefined}
                          onValueChange={(targetId) => patchChoice({ action: { type: 'redirect', modelId: targetId } })}
                        >
                          <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Target model" /></SelectTrigger>
                          <SelectContent>
                            {models.filter((model) => model.id !== modelId).map((model) => (
                              <SelectItem key={model.id} value={model.id} disabled={!model.enabled}>
                                {model.name}{!model.enabled ? ' (disabled)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {choice.action.type === 'params' && (
                        <div className="space-y-1">
                          <JsonObjectEditor
                            compact
                            value={choice.action.params}
                            onValidityChange={(valid) => setParameterEditorValidity(parameterEditorId, valid)}
                            onChange={(params) => patchChoice({ action: { type: 'params', params } })}
                          />
                          {allowedParameters.length > 0 && (
                            <p className="text-[11px] text-muted-foreground">Allowed: {allowedParameters.join(', ')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={preset.choices.length >= 20}
                  onClick={() => {
                    const id = newPresetId('choice', preset.choices.map((choice) => choice.id))
                    update(index, {
                      choices: [...preset.choices, { id, displayName: '', icon: null, action: { type: 'none' } }],
                    })
                  }}
                >
                  <Plus />
                  Add choice
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Default</Label>
                  <Select
                    value={preset.defaultChoiceId ?? 'none'}
                    onValueChange={(defaultChoiceId) => update(index, { defaultChoiceId: defaultChoiceId === 'none' ? null : defaultChoiceId })}
                  >
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">First choice</SelectItem>
                      {preset.choices.map((choice) => (
                        <SelectItem key={choice.id} value={choice.id}>{choice.displayName || 'Unnamed'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={presets.length >= 10}
          onClick={() => {
            const presetId = newPresetId('preset', presets.map((preset) => preset.id))
            const choiceId = newPresetId('choice', [])
            onChange([
              ...presets,
              {
                id: presetId,
                name: '',
                icon: 'circle',
                defaultChoiceId: choiceId,
                choices: [{ id: choiceId, displayName: 'Default', icon: null, action: { type: 'none' } }],
              },
            ])
          }}
        >
          <Plus />
          Add preset
        </Button>
      </div>
    </div>
  )
}
