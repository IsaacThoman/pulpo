import { useState, type ReactNode } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { MODELS } from '@/lib/mock'
import { ADMIN_PROVIDERS } from '@/lib/mock-admin'
import { formatNumber } from '@/lib/format'
import type { Model, SpeedOption } from '@/lib/types'
import { chatOptionsFor, useModelConfig } from '@/stores/modelConfig'
import { ModelIcon } from '@/components/ModelIcon'
import { AiLogo } from '@/components/ProviderLogo'
import { AI_ICONS, isAiIconAvailable, type AiIconKind } from '@/lib/ai-icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const ALL_SPEEDS: { value: SpeedOption; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'fast', label: 'Fast' },
]

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
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
    (icon) => isAiIconAvailable(icon, kind) && (kind !== 'lab' || !icon.color)
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
            <AiLogo
              icon={value}
              className="size-14 transition-transform duration-150 group-hover/tile:scale-105"
            />
            <Badge variant="secondary" className="absolute bottom-2 right-2 font-normal">
              {kind}
            </Badge>
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
                  value === icon.id && 'bg-accent ring-1 ring-border'
                )}
                title={`${icon.label}${icon.color ? ' · color' : ' · monochrome'}`}
              >
                <AiLogo icon={icon.id} className="size-7" />
                <span className="w-full truncate">{icon.label}</span>
                {value === icon.id && (
                  <Check className="absolute right-1 top-1 size-3 text-primary" />
                )}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{helper}</p>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
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
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

function ModelEditorDialog({
  model,
  open,
  onClose,
}: {
  model: Model
  open: boolean
  onClose: () => void
}) {
  const [jsonOpen, setJsonOpen] = useState(false)
  const [labLogo, setLabLogo] = useState(model.labLogo)
  const [modelLogo, setModelLogo] = useState(model.modelLogo)
  const [providerId, setProviderId] = useState(
    () => ADMIN_PROVIDERS.find((p) => p.name === model.provider)?.id ?? ADMIN_PROVIDERS[0]?.id ?? ''
  )
  const [upstreamModel, setUpstreamModel] = useState(model.id)
  const [inputPrice, setInputPrice] = useState(String(model.inputPrice))
  const [cachedPrice, setCachedPrice] = useState(String(model.inputPrice * 0.5))
  const [outputPrice, setOutputPrice] = useState(String(model.outputPrice))
  const [customParams, setCustomParams] = useState('{}')
  const [retryEnabled, setRetryEnabled] = useState(false)
  const [fallbackModelId, setFallbackModelId] = useState('')
  const [maxRetries, setMaxRetries] = useState('3')
  const [retryDelay, setRetryDelay] = useState('2')
  const [stickyBlock, setStickyBlock] = useState('60')
  const [firstTokenTimeoutEnabled, setFirstTokenTimeoutEnabled] = useState(false)
  const [firstTokenTimeout, setFirstTokenTimeout] = useState('15')
  const [slowStickyEnabled, setSlowStickyEnabled] = useState(false)
  const [slowMinTokPerSec, setSlowMinTokPerSec] = useState('10')
  const [slowMinCompletion, setSlowMinCompletion] = useState('5')
  const [ocrEnabled, setOcrEnabled] = useState(false)
  const overrides = useModelConfig((s) => s.overrides)
  const setOptions = useModelConfig((s) => s.setOptions)
  const [chatOptions, setChatOptions] = useState(() => chatOptionsFor(model, overrides))
  const reasoningInternalNames = chatOptions.reasoningEfforts.map((effort) =>
    effort.internalName.trim()
  )
  const reasoningEffortsValid =
    chatOptions.reasoningEfforts.every(
      (effort) => effort.displayName.trim() && effort.internalName.trim()
    ) && new Set(reasoningInternalNames).size === reasoningInternalNames.length
  const selectedProvider = ADMIN_PROVIDERS.find((p) => p.id === providerId)
  const stickySeconds = Number(stickyBlock) || 0

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[720px] max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2.5">
            <ModelIcon model={model} className="size-6 rounded-[3px]" />
            Edit model
            <Badge variant="outline" className="font-mono font-normal">{model.id}</Badge>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-6 py-5">
            <div className="grid grid-cols-2 gap-4">
              <LogoPickerTile
                label="Associated lab"
                helper="Monochrome company mark used in the model picker."
                kind="lab"
                value={labLogo}
                onChange={setLabLogo}
              />
              <LogoPickerTile
                label="Model logo"
                helper="Product mark used in chat, favorites, and model lists."
                kind="model"
                value={modelLogo}
                onChange={setModelLogo}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Model name">
                <Input defaultValue={model.name} />
              </Field>
              <Field label="Model ID">
                <Input defaultValue={model.id} disabled className="font-mono text-xs" />
              </Field>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} defaultValue={model.description} />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-sm font-medium">Upstream</div>
              <Field label="Provider">
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADMIN_PROVIDERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {selectedProvider && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <div className="text-xs font-medium">{selectedProvider.name}</div>
                  <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {selectedProvider.baseUrl}
                  </code>
                </div>
              )}
              <Field label="Upstream model">
                <Input
                  className="font-mono text-xs"
                  value={upstreamModel}
                  onChange={(e) => setUpstreamModel(e.target.value)}
                  placeholder="Select or type model name"
                />
              </Field>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-sm font-medium">Pricing</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Input $/M tokens">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={inputPrice}
                    onChange={(e) => setInputPrice(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="Cached $/M tokens">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={cachedPrice}
                    onChange={(e) => setCachedPrice(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="Output $/M tokens">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={outputPrice}
                    onChange={(e) => setOutputPrice(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              </div>
              <Field label="Custom parameters (JSON)">
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  value={customParams}
                  onChange={(e) => setCustomParams(e.target.value)}
                  placeholder='{"temperature": 0.7}'
                />
              </Field>
            </div>

            <Separator />

            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <ToggleRow
                label="Enable retry on failure"
                checked={retryEnabled}
                onChange={setRetryEnabled}
              />
              {retryEnabled && (
                <div className="space-y-3 pt-1">
                  <Field label="Fallback model">
                    <Select
                      value={fallbackModelId || '__same__'}
                      onValueChange={(v) => setFallbackModelId(v === '__same__' ? '' : v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__same__">
                          Same model ({model.name}) — retry on current
                        </SelectItem>
                        {MODELS.filter((m) => m.id !== model.id).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Max retries">
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={maxRetries}
                        onChange={(e) => setMaxRetries(e.target.value)}
                        className="tabular-nums"
                      />
                    </Field>
                    <Field label="Retry delay (sec)">
                      <Input
                        type="number"
                        min={0}
                        max={300}
                        value={retryDelay}
                        onChange={(e) => setRetryDelay(e.target.value)}
                        className="tabular-nums"
                      />
                    </Field>
                    <Field label="Sticky block (sec)">
                      <Input
                        type="number"
                        min={0}
                        max={3600}
                        value={stickyBlock}
                        onChange={(e) => setStickyBlock(e.target.value)}
                        className="tabular-nums"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ToggleRow
                      label="Fallback if no first streamed token arrives in time"
                      checked={firstTokenTimeoutEnabled}
                      onChange={setFirstTokenTimeoutEnabled}
                    />
                    <Field label="First token timeout (sec)">
                      <Input
                        type="number"
                        min={1}
                        max={300}
                        value={firstTokenTimeout}
                        onChange={(e) => setFirstTokenTimeout(e.target.value)}
                        disabled={!firstTokenTimeoutEnabled}
                        className="tabular-nums"
                      />
                    </Field>
                  </div>
                  <div className="space-y-3">
                    <ToggleRow
                      label="Sticky-block slow completions"
                      checked={slowStickyEnabled}
                      onChange={setSlowStickyEnabled}
                      disabled={stickySeconds <= 0}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Min avg output tok/sec">
                        <Input
                          type="number"
                          min={0.1}
                          max={1000}
                          step={0.1}
                          value={slowMinTokPerSec}
                          onChange={(e) => setSlowMinTokPerSec(e.target.value)}
                          disabled={!slowStickyEnabled || stickySeconds <= 0}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="Min completion time (sec)">
                        <Input
                          type="number"
                          min={1}
                          max={3600}
                          value={slowMinCompletion}
                          onChange={(e) => setSlowMinCompletion(e.target.value)}
                          disabled={!slowStickyEnabled || stickySeconds <= 0}
                          className="tabular-nums"
                        />
                      </Field>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    If “Same model” is selected, retries use the current model. Sticky block
                    temporarily routes to fallback without attempting the primary. First-token
                    timeout applies to streamed requests only. Slow sticky blocking requires sticky
                    block &gt; 0.
                  </p>
                </div>
              )}
            </div>

            <ToggleRow label="Enable OCR for images" checked={ocrEnabled} onChange={setOcrEnabled} />

            <Separator />

            <div className="space-y-1.5">
              <Label>System prompt</Label>
              <Textarea rows={3} placeholder="You are a helpful assistant." />
            </div>

            <div className="space-y-2">
              <Label>Chat options</Label>
              <p className="text-[11px] text-muted-foreground">
                Configure the choices users can pick in the composer. Reasoning internal names are
                sent to the model API.
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Reasoning effort</div>
                  {chatOptions.reasoningEfforts.length > 0 && (
                    <div className="grid grid-cols-[1fr_1fr_32px] gap-2 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>Display name</span>
                      <span>Internal name</span>
                      <span />
                    </div>
                  )}
                  {chatOptions.reasoningEfforts.map((effort, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_32px] gap-2">
                      <Input
                        value={effort.displayName}
                        onChange={(event) =>
                          setChatOptions((options) => ({
                            ...options,
                            reasoningEfforts: options.reasoningEfforts.map((option, optionIndex) =>
                              optionIndex === index
                                ? { ...option, displayName: event.target.value }
                                : option
                            ),
                          }))
                        }
                        placeholder="e.g. High"
                        className="h-8"
                      />
                      <Input
                        value={effort.internalName}
                        onChange={(event) =>
                          setChatOptions((options) => ({
                            ...options,
                            reasoningEfforts: options.reasoningEfforts.map((option, optionIndex) =>
                              optionIndex === index
                                ? { ...option, internalName: event.target.value }
                                : option
                            ),
                          }))
                        }
                        placeholder="e.g. high"
                        className="h-8 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${effort.displayName || 'reasoning effort'}`}
                        onClick={() =>
                          setChatOptions((options) => ({
                            ...options,
                            reasoningEfforts: options.reasoningEfforts.filter(
                              (_, optionIndex) => optionIndex !== index
                            ),
                          }))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setChatOptions((options) => ({
                        ...options,
                        reasoningEfforts: [
                          ...options.reasoningEfforts,
                          { displayName: '', internalName: '' },
                        ],
                      }))
                    }
                  >
                    <Plus />
                    Add effort
                  </Button>
                  {!reasoningEffortsValid && (
                    <p className="text-xs text-destructive">
                      Each effort needs a display name and a unique internal name.
                    </p>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Speed</div>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_SPEEDS.map(({ value, label }) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-sm hover:bg-accent/60"
                      >
                        {label}
                        <Switch
                          checked={chatOptions.speedOptions.includes(value)}
                          onCheckedChange={() =>
                            setChatOptions((o) => ({
                              ...o,
                              speedOptions: toggleInList(o.speedOptions, value),
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Default features</Label>
              <div className="flex gap-2">
                {['code_interpreter'].map((f) => (
                  <Badge key={f} variant="secondary" className="font-normal">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>

            <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
              <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
                <ChevronRight className={cn('size-4 transition-transform', jsonOpen && 'rotate-90')} />
                JSON preview
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
{JSON.stringify(
  {
    id: model.id,
    name: model.name,
    provider_id: providerId,
    upstream_model_name: upstreamModel,
    input_cost_per_million: Number(inputPrice) || 0,
    cached_input_cost_per_million: Number(cachedPrice) || 0,
    output_cost_per_million: Number(outputPrice) || 0,
    custom_params: customParams,
    fallback_enabled: retryEnabled,
    fallback_model_id: fallbackModelId || null,
    max_retries: Number(maxRetries) || 0,
    fallback_delay_seconds: Number(retryDelay) || 0,
    sticky_fallback_seconds: Number(stickyBlock) || 0,
    first_token_timeout_enabled: firstTokenTimeoutEnabled,
    first_token_timeout_seconds: Number(firstTokenTimeout) || 0,
    slow_sticky_enabled: slowStickyEnabled,
    slow_sticky_min_tokens_per_second: Number(slowMinTokPerSec) || 0,
    slow_sticky_min_completion_seconds: Number(slowMinCompletion) || 0,
    intercept_images_with_ocr: ocrEnabled,
    meta: {
      lab_logo: labLogo,
      model_logo: modelLogo,
      description: model.description,
      chat_options: {
        reasoning_efforts: chatOptions.reasoningEfforts.map((effort) => ({
          display_name: effort.displayName,
          internal_name: effort.internalName,
        })),
        speed_options: chatOptions.speedOptions,
      },
    },
  },
  null,
  2
)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </ScrollArea>
        <div className="flex justify-end gap-2 border-t px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reasoningEffortsValid}
            onClick={() => {
              setOptions(model.id, {
                ...chatOptions,
                reasoningEfforts: chatOptions.reasoningEfforts.map((effort) => ({
                  displayName: effort.displayName.trim(),
                  internalName: effort.internalName.trim(),
                })),
              })
              onClose()
            }}
          >
            Save & update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AdminModelsPage() {
  const [query, setQuery] = useState('')
  const [view, setView] = useState('visible')
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODELS.map((m) => [m.id, m.enabled]))
  )
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Model | null>(null)

  const filtered = MODELS.filter((m) => {
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false
    if (view === 'enabled' && !enabled[m.id]) return false
    if (view === 'disabled' && enabled[m.id]) return false
    if (view === 'hidden' && !hidden[m.id]) return false
    if (view === 'visible' && hidden[m.id]) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Models</h2>
        <Badge variant="secondary">{MODELS.length}</Badge>
        <div className="flex-1" />
        <Button size="sm">
          <Plus />
          New model
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search models…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={view} onValueChange={setView}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['visible', 'hidden', 'all', 'enabled', 'disabled'].map((v) => (
              <SelectItem key={v} value={v} className="capitalize">
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.map((m) => (
          <Card key={m.id} className={cn('shadow-none', !enabled[m.id] && 'opacity-55')}>
            <CardContent className="flex items-center gap-4 px-4 py-3">
              <ModelIcon model={m} className="size-8 rounded-[4px]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  <Badge variant="outline" className="font-normal">
                    {m.provider}
                  </Badge>
                  {hidden[m.id] && (
                    <Badge variant="secondary" className="font-normal">
                      hidden
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {m.description} · {formatNumber(m.contextWindow)} ctx
                </div>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => setEditing(m)} title="Edit">
                <Pencil className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" title="More">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setHidden((h) => ({ ...h, [m.id]: !h[m.id] }))}>
                    {hidden[m.id] ? <Eye /> : <EyeOff />}
                    {hidden[m.id] ? 'Show model' : 'Hide model'}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link2 />
                    Copy link
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy />
                    Clone
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Download />
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Switch
                checked={enabled[m.id]}
                onCheckedChange={(v) => setEnabled((e) => ({ ...e, [m.id]: v }))}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <ModelEditorDialog model={editing} open={!!editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
