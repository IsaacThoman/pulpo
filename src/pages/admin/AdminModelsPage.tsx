import { useState } from 'react'
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
  Settings2,
  Upload,
} from 'lucide-react'
import { MODELS } from '@/lib/mock'
import { formatNumber } from '@/lib/format'
import type { Model } from '@/lib/types'
import { ModelIcon } from '@/components/ModelIcon'
import { AiLogo } from '@/components/ProviderLogo'
import { AI_ICONS, getAiIcon, type AiIconKind } from '@/lib/ai-icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
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

const CAPABILITIES = [
  'Vision',
  'File Upload',
  'Web Search',
  'Image Generation',
  'Code Interpreter',
  'Terminal',
  'Usage',
  'Citations',
  'Status Updates',
  'Builtin Tools',
]

const DEFAULT_PARAMS = { temperature: 1.0, topP: 1.0, topK: 0, seed: 0, maxTokens: 4096, frequencyPenalty: 0 }

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
  const selected = getAiIcon(value)
  const options = AI_ICONS.filter(
    (icon) => icon.kind === kind && (kind !== 'lab' || !icon.color)
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
              {selected.kind === 'lab' ? 'lab' : 'model'}
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

function ModelEditorDialog({
  model,
  open,
  onClose,
}: {
  model: Model
  open: boolean
  onClose: () => void
}) {
  const [paramsOpen, setParamsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [labLogo, setLabLogo] = useState(model.labLogo)
  const [modelLogo, setModelLogo] = useState(model.modelLogo)
  const [caps, setCaps] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      CAPABILITIES.map((c) => [
        c,
        (c === 'Vision' && model.tags.includes('vision')) ||
          (c === 'Web Search' && model.tags.includes('tools')) ||
          (c === 'Code Interpreter' && model.tags.includes('code')),
      ])
    )
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[640px] max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
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
              <div className="space-y-1.5">
                <Label>Model name</Label>
                <Input defaultValue={model.name} />
              </div>
              <div className="space-y-1.5">
                <Label>Model ID</Label>
                <Input defaultValue={model.id} disabled className="font-mono text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Base model (from)</Label>
                <Select defaultValue={model.id}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Access</Label>
                <Select defaultValue="public">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="admin">Admin only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} defaultValue={model.description} />
            </div>

            <div className="space-y-1.5">
              <Label>System prompt</Label>
              <Textarea rows={3} placeholder="You are a helpful assistant." />
            </div>

            <Collapsible open={paramsOpen} onOpenChange={setParamsOpen}>
              <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
                <ChevronRight className={cn('size-4 transition-transform', paramsOpen && 'rotate-90')} />
                Advanced params
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 grid grid-cols-3 gap-3">
                {(
                  [
                    ['temperature', 'Temperature', 0.1],
                    ['topP', 'Top P', 0.05],
                    ['topK', 'Top K', 1],
                    ['seed', 'Seed', 1],
                    ['maxTokens', 'Max tokens', 128],
                    ['frequencyPenalty', 'Freq. penalty', 0.1],
                  ] as const
                ).map(([key, label, step]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input type="number" step={step} defaultValue={DEFAULT_PARAMS[key]} />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>

            <div className="space-y-2">
              <Label>Capabilities</Label>
              <div className="grid grid-cols-2 gap-x-4">
                {CAPABILITIES.map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-sm hover:bg-accent/60"
                  >
                    {c}
                    <Switch
                      checked={caps[c]}
                      onCheckedChange={(v) => setCaps((s) => ({ ...s, [c]: v }))}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Default features</Label>
              <div className="flex gap-2">
                {['web_search', 'code_interpreter', 'image_generation'].map((f) => (
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
    meta: {
      lab_logo: labLogo,
      model_logo: modelLogo,
      profile_image_url_light: `/models/${model.id}/light.png`,
      profile_image_url_dark: `/models/${model.id}/dark.png`,
      description: model.description,
      capabilities: caps,
    },
    params: DEFAULT_PARAMS,
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
          <Button onClick={onClose}>Save & update</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AdminModelsPage() {
  const [query, setQuery] = useState('')
  const [view, setView] = useState('all')
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
        <Button variant="outline" size="sm">
          <Upload />
          Import
        </Button>
        <Button variant="outline" size="sm">
          <Download />
          Export
        </Button>
        <Button variant="outline" size="sm">
          <Settings2 />
          Manage
        </Button>
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
            {['all', 'enabled', 'disabled', 'visible', 'hidden'].map((v) => (
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
