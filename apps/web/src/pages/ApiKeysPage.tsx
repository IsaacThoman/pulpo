import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  Search,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useApiKeys } from '@/stores/apiKeys'
import { useCatalog } from '@/stores/catalog'
import { formatCost, maskKey, timeAgo } from '@/lib/format'
import type { ApiKey } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckboxRow, Snippet } from '@/components/api/misc'
import { runtimeInstanceUrl } from '@/lib/runtime'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { ModelIcon } from '@/components/ModelIcon'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { ui, uit } from '@/i18n/ui'

const ALL_SCOPES = [
  { id: 'responses', label: "Responses" },
  { id: 'models', label: "List models" },
] as const

const API_BASE_URL = `${runtimeInstanceUrl()}/v1`

const CURL_SNIPPET = `curl ${API_BASE_URL}/responses \\
  -H "Authorization: Bearer $PULPO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-model-id",
    "input": "hello",
    "stream": true
  }'`

const SDK_SNIPPET = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API_BASE_URL}",
  apiKey: process.env.PULPO_API_KEY,
});

const stream = await client.responses.create({
  model: "your-model-id",
  input: "hello",
  stream: true,
});

for await (const chunk of stream) {
  if (chunk.type === "response.output_text.delta") process.stdout.write(chunk.delta);
}`

function LimitRow({
  amount,
  spent,
  kind,
}: {
  amount: number
  spent: number
  kind: 'month' | 'total'
}) {
  const pct = Math.min(100, (spent / amount) * 100)
  return (
    <div className="min-w-0 lg:min-w-[120px]">
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums">{formatCost(amount)}</span>
        <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
          {kind === 'total' ? ui("TOTAL") : ui("MONTH")}
        </span>
      </div>
      <div className="mt-1.5 h-1 w-full max-w-[110px] overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full bg-foreground', pct > 85 && 'bg-destructive')}
          style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  )
}

function LimitCell({ k }: { k: ApiKey }) {
  const rows: { amount: number; spent: number; kind: 'month' | 'total' }[] = []
  if (k.monthlyBudget != null) {
    rows.push({ amount: k.monthlyBudget, spent: k.spentThisMonth ?? 0, kind: 'month' })
  }
  if (k.totalBudget != null) {
    rows.push({ amount: k.totalBudget, spent: k.spentTotal ?? 0, kind: 'total' })
  }
  if (rows.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <LimitRow key={r.kind} amount={r.amount} spent={r.spent} kind={r.kind} />
      ))}
    </div>
  )
}

export function ApiKeysPage() {
  const apiKeysEnabled = useAuth((state) => state.apiKeysEnabled)
  const keys = useApiKeys((s) => s.keys)
  const createKey = useApiKeys((s) => s.createKey)
  const revokeKey = useApiKeys((s) => s.revokeKey)
  const deleteKey = useApiKeys((s) => s.deleteKey)
  const load = useApiKeys((s) => s.load)
  const models = useCatalog((state) => state.models)

  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['responses', 'models'])
  const [allModels, setAllModels] = useState(true)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [monthlyBudget, setMonthlyBudget] = useState('')
  const [totalBudget, setTotalBudget] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null)
  const [usageDocsOpen, setUsageDocsOpen] = useState(false)

  useEffect(() => { void load() }, [load])

  const selectableModels = models.filter((m) => m.enabled)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return keys
    return keys.filter(
      (k) => k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q)
    )
  }, [keys, query])

  const resetCreateForm = () => {
    setName('')
    setMonthlyBudget('')
    setTotalBudget('')
    setAllModels(true)
    setSelectedModels([])
    setScopes(['responses', 'models'])
  }

  const toggleModel = (id: string, on: boolean) => {
    setAllModels(false)
    setSelectedModels((cur) => {
      if (on) return cur.includes(id) ? cur : [...cur, id]
      return cur.filter((x) => x !== id)
    })
  }

  const submit = async () => {
    const { secret } = await createKey({
      name: name.trim() || 'untitled key',
      scopes: scopes as ApiKey['scopes'],
      allowedModels: allModels ? [] : selectedModels,
      monthlyBudget: monthlyBudget ? parseFloat(monthlyBudget) : null,
      totalBudget: totalBudget ? parseFloat(totalBudget) : null,
    })
    setSecret(secret)
    setRevealed(false)
    setCopied(false)
    setCreateOpen(false)
    resetCreateForm()
  }

  const modelLabel = (ids: string[]) => {
    if (ids.length === 0) return ui("All models")
    if (ids.length === 1) return models.find((m) => m.id === ids[0])?.name ?? '1 model'
    return `${ids.length} models`
  }

  const canCreate = scopes.length > 0 && (allModels || selectedModels.length > 0)

  const keyActions = (key: ApiKey) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={uit`Actions for ${key.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          onClick={() => navigator.clipboard?.writeText(key.prefix).catch(() => {})}
        >
          <Copy /> {ui("Copy prefix")} </DropdownMenuItem>
        {!key.revoked && (
          <DropdownMenuItem onClick={() => setConfirmRevoke(key)}> {ui("Revoke")} </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void deleteKey(key.id)}>
          <Trash2 /> {ui("Delete")} </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!apiKeysEnabled) return <div className="grid h-full place-items-center p-8"><div className="max-w-md rounded-xl border p-6 text-center"><TriangleAlert className="mx-auto size-8 text-amber-500" /><h1 className="mt-3 text-lg font-semibold">{ui("API keys are disabled")}</h1><p className="mt-2 text-sm text-muted-foreground">{ui("The administrator has suspended API-key authentication. Existing keys remain stored and can be used again if the policy is re-enabled.")}</p></div></div>

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        {/* header */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{ui("API Keys")}</h1>
            <p className="mt-1 text-sm text-muted-foreground"> {ui("Create and manage OpenAI-compatible keys.")}{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {API_BASE_URL}
              </code>
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> {ui("New Key")} </Button>
        </div>

        {/* search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={ui("Search by name…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* mobile list */}
        <div className="divide-y rounded-xl border lg:hidden">
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {keys.length === 0 ? ui("No keys yet — create one to get started.") : ui("No keys match your search.")}
            </p>
          )}
          {filtered.map((key) => (
            <div key={key.id} className={cn('p-4', key.revoked && 'opacity-50')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{key.name}</span>
                    {key.revoked && <Badge variant="destructive" className="h-5 shrink-0 px-1.5 text-[10px]">{ui("revoked")}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{maskKey(key.prefix)}</div>
                </div>
                {keyActions(key)}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{ui("Models")}</dt>
                  <dd className="mt-1 truncate">{modelLabel(key.allowedModels)}</dd>
                  <dd className="truncate text-[11px] text-muted-foreground/80">{key.scopes.join(' · ')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{ui("Last used")}</dt>
                  <dd className="mt-1">{key.lastUsedAt ? timeAgo(key.lastUsedAt) : ui("Never")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{ui("Usage")}</dt>
                  <dd className="mt-1 tabular-nums">{formatCost(key.spentTotal ?? 0)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{ui("Limit")}</dt>
                  <dd className="mt-1"><LimitCell k={key} /></dd>
                </div>
              </dl>
            </div>
          ))}
          {keys.length > 0 && (
            <div className="px-4 py-2.5 text-xs text-muted-foreground">
              {filtered.length === keys.length
                ? uit`${keys.length} key${keys.length === 1 ? '' : 's'}`
                : uit`${filtered.length} of ${keys.length} keys`}
            </div>
          )}
        </div>

        {/* desktop table */}
        <div className="hidden overflow-hidden rounded-lg border lg:block">
          <table className="data-table">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2">{ui("Key")}</th>
                <th className="px-3 py-2">{ui("Models")}</th>
                <th className="px-3 py-2">{ui("Last used")}</th>
                <th className="px-3 py-2">{ui("Usage")}</th>
                <th className="px-3 py-2">{ui("Limit")}</th>
                <th className="w-12 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    {keys.length === 0 ? ui("No keys yet — create one to get started.") : ui("No keys match your search.")}
                  </td>
                </tr>
              )}
              {filtered.map((k) => (
                <tr
                  key={k.id}
                  className={cn(k.revoked && 'opacity-50')}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{k.name}</span>
                          {k.revoked && (
                            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]"> {ui("revoked")} </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {maskKey(k.prefix)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span title={modelLabel(k.allowedModels)}>{modelLabel(k.allowedModels)}</span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {k.scopes.slice(0, 2).map((s) => (
                        <span key={s} className="text-[11px] text-muted-foreground/80">
                          {s}
                          {k.scopes.indexOf(s) < Math.min(1, k.scopes.length - 1) ? ' ·' : ''}
                        </span>
                      ))}
                      {k.scopes.length > 2 && (
                        <span className="text-[11px] text-muted-foreground/80">
                          +{k.scopes.length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {k.lastUsedAt ? timeAgo(k.lastUsedAt) : ui("Never")}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatCost(k.spentTotal ?? 0)}
                  </td>
                  <td className="px-3 py-2">
                    <LimitCell k={k} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    {keyActions(k)}
                  </td>
                </tr>
              ))}
            </tbody>
            {keys.length > 0 && (
              <tfoot>
                <tr className="border-t">
                  <td colSpan={6} className="px-3 py-2 text-muted-foreground">
                    {filtered.length === keys.length
                      ? uit`${keys.length} key${keys.length === 1 ? '' : 's'}`
                      : uit`${filtered.length} of ${keys.length} keys`}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* usage docs */}
        <Collapsible open={usageDocsOpen} onOpenChange={setUsageDocsOpen} asChild>
          <Card className="shadow-none">
            <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-6 text-left">
              <ChevronRight
                className={cn('size-4 transition-transform', usageDocsOpen && 'rotate-90')}
              />
              <Terminal className="size-4" />
              <span className="text-sm font-semibold">{ui("Using the API")}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  {[
                    ['POST', '/v1/responses'],
                    ['GET', '/v1/models'],
                    ['GET', '/v1/responses/:id'],
                  ].map(([method, path]) => (
                    <div
                      key={path}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    >
                      <Badge
                        variant={method === 'GET' ? 'secondary' : 'default'}
                        className="font-mono text-[10px]"
                      >
                        {method}
                      </Badge>
                      <code className="font-mono text-xs">{path}</code>
                    </div>
                  ))}
                </div>
                <Snippet title={ui("curl")} code={CURL_SNIPPET} />
                <Snippet title={ui("openai (node)")} code={SDK_SNIPPET} />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

      {/* create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ui("Create API key")}</DialogTitle>
            <DialogDescription> {ui("The secret is shown exactly once. Store it somewhere safe.")} </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">{ui("Name")}</Label>
              <Input
                id="key-name"
                placeholder={ui("e.g. laptop scripts")}
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                    if (!m) return null
                    return (
                      <Badge key={id} variant="secondary" className="gap-1 font-normal">
                        <ModelIcon model={m} className="size-3" boxed={false} />
                        {m.name}
                        <button
                          type="button"
                          className="ml-0.5 cursor-pointer opacity-60 hover:opacity-100"
                          onClick={() => toggleModel(id, false)}
                          aria-label={uit`Remove ${m.name}`}
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
                    min="0"
                    step="1"
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
                    min="0"
                    step="1"
                    placeholder={ui("none")}
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground"> {ui("Monthly resets each billing period. All-time is a lifetime cap for this key.")} </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}> {ui("Cancel")} </Button>
            <Button onClick={submit} disabled={!canCreate}> {ui("Create")} </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* secret reveal */}
      <Dialog open={!!secret} onOpenChange={(v) => !v && setSecret(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ui("Save your API key")}</DialogTitle>
            <DialogDescription> {ui("This is the only time the full key will be shown.")} </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">
              {revealed ? secret : secret?.replace(/(?<=sk-pulpo-)./g, '•')}
            </code>
            <button
              className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? ui("Hide key") : ui("Show key")}
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            <button
              className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (secret) navigator.clipboard?.writeText(secret).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              aria-label={ui("Copy key")}
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </button>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {ui("Treat this key like a password. Anyone with it can spend against your balance.")} </div>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{ui("Done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* revoke confirm */}
      <Dialog open={!!confirmRevoke} onOpenChange={(v) => !v && setConfirmRevoke(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{ui("Revoke “")}{confirmRevoke?.name}”?</DialogTitle>
            <DialogDescription> {ui("Requests using this key will start failing immediately. This cannot be undone.")} </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}> {ui("Cancel")} </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmRevoke) void revokeKey(confirmRevoke.id)
                setConfirmRevoke(null)
              }}
            > {ui("Revoke key")} </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
