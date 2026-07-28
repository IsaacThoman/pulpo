import { useState } from 'react'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useApiKeys } from '@/stores/apiKeys'
import { MODELS } from '@/lib/mock'
import { formatCost, formatDate, maskKey, timeAgo } from '@/lib/format'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const ALL_SCOPES = [
  { id: 'chat', label: 'Chat completions' },
  { id: 'embeddings', label: 'Embeddings' },
  { id: 'images', label: 'Image generation' },
  { id: 'models', label: 'List models' },
] as const

const CURL_SNIPPET = `curl https://api.kimi.dev/v1/chat/completions \\
  -H "Authorization: Bearer $KIMI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kimi-k3",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'`

const SDK_SNIPPET = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.kimi.dev/v1",
  apiKey: process.env.KIMI_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "kimi-k3",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`

function BudgetBar({ k }: { k: ApiKey }) {
  if (!k.monthlyBudget) return <span className="text-xs text-muted-foreground">no limit</span>
  const pct = Math.min(100, (k.spentThisMonth / k.monthlyBudget) * 100)
  return (
    <div className="w-28">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{formatCost(k.spentThisMonth)}</span>
        <span>{formatCost(k.monthlyBudget)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', pct > 85 ? 'bg-destructive' : 'bg-emerald-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function ApiKeysPage() {
  const keys = useApiKeys((s) => s.keys)
  const createKey = useApiKeys((s) => s.createKey)
  const revokeKey = useApiKeys((s) => s.revokeKey)
  const deleteKey = useApiKeys((s) => s.deleteKey)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['chat', 'models'])
  const [modelRestriction, setModelRestriction] = useState('all')
  const [budget, setBudget] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null)

  const submit = () => {
    const { secret } = createKey({
      name: name.trim() || 'untitled key',
      scopes: scopes as ApiKey['scopes'],
      allowedModels: modelRestriction === 'all' ? [] : [modelRestriction],
      monthlyBudget: budget ? parseFloat(budget) : null,
    })
    setSecret(secret)
    setRevealed(false)
    setCopied(false)
    setCreateOpen(false)
    setName('')
    setBudget('')
    setModelRestriction('all')
    setScopes(['chat', 'models'])
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold">API keys</h1>
            <p className="text-sm text-muted-foreground">
              OpenAI-compatible access for your scripts and tools. Base URL:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                https://api.kimi.dev/v1
              </code>
            </p>
          </div>
          <div className="flex-1" />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Create key
          </Button>
        </div>

        <div className="space-y-3">
          {keys.length === 0 && (
            <Card className="shadow-none">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <KeyRound className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No keys yet — create one to get started.</p>
              </CardContent>
            </Card>
          )}
          {keys.map((k) => (
            <Card key={k.id} className={cn('shadow-none', k.revoked && 'opacity-60')}>
              <CardContent className="flex items-center gap-5 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    {k.revoked ? (
                      <Badge variant="destructive">revoked</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                        active
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{maskKey(k.prefix)}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="font-normal">
                        {s}
                      </Badge>
                    ))}
                    <Badge variant="outline" className="font-normal">
                      {k.allowedModels.length === 0 ? 'all models' : `${k.allowedModels.length} model(s)`}
                    </Badge>
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    created {formatDate(k.createdAt)} ·{' '}
                    {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : 'never used'}
                  </div>
                </div>
                <BudgetBar k={k} />
                <div className="flex gap-1">
                  {!k.revoked && (
                    <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(k)}>
                      Revoke
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => deleteKey(k.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
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
                  <Badge variant={method === 'GET' ? 'secondary' : 'default'} className="font-mono text-[10px]">
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
              <Select value={modelRestriction} onValueChange={setModelRestriction}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All models</SelectItem>
                  {MODELS.filter((m) => m.enabled).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} only
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-budget">Monthly budget (optional)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="key-budget"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="no limit"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={scopes.length === 0}>
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
              {revealed ? secret : secret?.replace(/(?<=sk-kimi-)./g, '•')}
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
