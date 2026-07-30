import { useMemo, useState } from 'react'
import {
  Check,
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
import { MODELS } from '@/lib/mock'
import { formatCost, maskKey, timeAgo } from '@/lib/format'
import type { ApiKey } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckboxRow, Snippet } from '@/components/api/misc'
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

const ALL_SCOPES = [
  { id: 'chat', label: 'Chat completions' },
  { id: 'embeddings', label: 'Embeddings' },
  { id: 'images', label: 'Image generation' },
  { id: 'models', label: 'List models' },
] as const

const CURL_SNIPPET = `curl https://api.pulpo.dev/v1/chat/completions \\
  -H "Authorization: Bearer $PULPO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kimi-k3",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'`

const SDK_SNIPPET = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.pulpo.dev/v1",
  apiKey: process.env.PULPO_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "kimi-k3",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
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
    <div className="min-w-[120px]">
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums">{formatCost(amount)}</span>
        <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
          {kind === 'total' ? 'TOTAL' : 'MONTH'}
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
  const keys = useApiKeys((s) => s.keys)
  const createKey = useApiKeys((s) => s.createKey)
  const revokeKey = useApiKeys((s) => s.revokeKey)
  const deleteKey = useApiKeys((s) => s.deleteKey)

  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['chat', 'models'])
  const [allModels, setAllModels] = useState(true)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [monthlyBudget, setMonthlyBudget] = useState('')
  const [totalBudget, setTotalBudget] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null)

  const selectableModels = MODELS.filter((m) => m.enabled)

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
    setScopes(['chat', 'models'])
  }

  const toggleModel = (id: string, on: boolean) => {
    setAllModels(false)
    setSelectedModels((cur) => {
      if (on) return cur.includes(id) ? cur : [...cur, id]
      return cur.filter((x) => x !== id)
    })
  }

  const submit = () => {
    const { secret } = createKey({
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
    if (ids.length === 0) return 'All models'
    if (ids.length === 1) return MODELS.find((m) => m.id === ids[0])?.name ?? '1 model'
    return `${ids.length} models`
  }

  const canCreate = scopes.length > 0 && (allModels || selectedModels.length > 0)

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        {/* header */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">API Keys</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create and manage OpenAI-compatible keys.{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                https://api.pulpo.dev/v1
              </code>
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New Key
          </Button>
        </div>

        {/* search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* table */}
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Models</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Limit</th>
                <th className="w-12 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {keys.length === 0 ? 'No keys yet — create one to get started.' : 'No keys match your search.'}
                  </td>
                </tr>
              )}
              {filtered.map((k) => (
                <tr
                  key={k.id}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-muted/30',
                    k.revoked && 'opacity-50'
                  )}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{k.name}</span>
                          {k.revoked && (
                            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                              revoked
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {maskKey(k.prefix)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
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
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">
                    {formatCost(k.spentTotal ?? 0)}
                  </td>
                  <td className="px-4 py-3.5">
                    <LimitCell k={k} />
                  </td>
                  <td className="px-2 py-3.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label="Key actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() =>
                            navigator.clipboard?.writeText(k.prefix).catch(() => {})
                          }
                        >
                          <Copy />
                          Copy prefix
                        </DropdownMenuItem>
                        {!k.revoked && (
                          <DropdownMenuItem onClick={() => setConfirmRevoke(k)}>
                            Revoke
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => deleteKey(k.id)}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
            {keys.length > 0 && (
              <tfoot>
                <tr className="border-t">
                  <td colSpan={6} className="px-4 py-2.5 text-xs text-muted-foreground">
                    {filtered.length === keys.length
                      ? `${keys.length} key${keys.length === 1 ? '' : 's'}`
                      : `${filtered.length} of ${keys.length} keys`}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* usage docs */}
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="size-4" />
              Using the API
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ['POST', '/v1/chat/completions'],
                ['GET', '/v1/models'],
                ['POST', '/v1/embeddings'],
                ['POST', '/v1/images/generations'],
              ].map(([method, path]) => (
                <div key={path} className="flex items-center gap-2 rounded-lg border px-3 py-2">
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
            <Snippet title="curl" code={CURL_SNIPPET} />
            <Snippet title="openai (node)" code={SDK_SNIPPET} />
          </CardContent>
        </Card>
      </div>

      {/* create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The secret is shown exactly once. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. laptop scripts"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scopes</Label>
              <div className="space-y-1">
                {ALL_SCOPES.map((s) => (
                  <CheckboxRow
                    key={s.id}
                    label={s.label}
                    checked={scopes.includes(s.id)}
                    onChange={(v) =>
                      setScopes((cur) => (v ? [...cur, s.id] : cur.filter((x) => x !== s.id)))
                    }
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Model access</Label>
              <p className="text-xs text-muted-foreground">
                Restrict this key to specific models, or allow every model.
              </p>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
                <CheckboxRow
                  label="All models"
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
                <p className="text-xs text-destructive">
                  Select at least one model, or choose All models.
                </p>
              )}
              {!allModels && selectedModels.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {selectedModels.map((id) => {
                    const m = MODELS.find((x) => x.id === id)
                    if (!m) return null
                    return (
                      <Badge key={id} variant="secondary" className="gap-1 font-normal">
                        <ModelIcon model={m} className="size-3" boxed={false} />
                        {m.name}
                        <button
                          type="button"
                          className="ml-0.5 cursor-pointer opacity-60 hover:opacity-100"
                          onClick={() => toggleModel(id, false)}
                          aria-label={`Remove ${m.name}`}
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
                <Label htmlFor="key-budget-monthly">Monthly limit</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="key-budget-monthly"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="none"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key-budget-total">All-time limit</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="key-budget-total"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="none"
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Monthly resets each billing period. All-time is a lifetime cap for this key.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canCreate}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* secret reveal */}
      <Dialog open={!!secret} onOpenChange={(v) => !v && setSecret(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>
              This is the only time the full key will be shown.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2.5">
            <code className="flex-1 truncate font-mono text-xs">
              {revealed ? secret : secret?.replace(/(?<=sk-pulpo-)./g, '•')}
            </code>
            <button
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Hide key' : 'Show key'}
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            <button
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (secret) navigator.clipboard?.writeText(secret).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              aria-label="Copy key"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </button>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Treat this key like a password. Anyone with it can spend against your balance.
          </div>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* revoke confirm */}
      <Dialog open={!!confirmRevoke} onOpenChange={(v) => !v && setConfirmRevoke(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke “{confirmRevoke?.name}”?</DialogTitle>
            <DialogDescription>
              Requests using this key will start failing immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmRevoke) revokeKey(confirmRevoke.id)
                setConfirmRevoke(null)
              }}
            >
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
