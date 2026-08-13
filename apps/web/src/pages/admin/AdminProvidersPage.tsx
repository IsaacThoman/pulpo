import { useEffect, useState } from 'react'
import { Activity, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { apiRequest } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type CacheAffinityMode = 'none' | 'openai_prompt_cache_key' | 'fireworks_session_affinity'
type CacheIsolationMode = 'none' | 'fireworks_prompt_cache_isolation'
type CacheScope = 'agent_run' | 'chat' | 'user'

interface AdminProvider {
  id: string
  name: string
  baseUrl: string
  hasApiKey: boolean
  modelCount: number
  cacheAffinityMode: CacheAffinityMode
  cacheAffinityScope: CacheScope
  cacheIsolationMode: CacheIsolationMode
  cacheIsolationScope: CacheScope
  lastHealthStatus?: string | null
}
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Draft = {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  cacheAffinityMode: CacheAffinityMode
  cacheAffinityScope: CacheScope
  cacheIsolationMode: CacheIsolationMode
  cacheIsolationScope: CacheScope
}

const emptyDraft = (): Draft => ({
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  cacheAffinityMode: 'openai_prompt_cache_key',
  cacheAffinityScope: 'chat',
  cacheIsolationMode: 'none',
  cacheIsolationScope: 'user',
})

export function AdminProvidersPage() {
  const [providers, setProviders] = useState<AdminProvider[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [showKey, setShowKey] = useState(false)

  const load = async () => {
    const [providerResponse, modelResponse] = await Promise.all([
      apiRequest<{ data: Omit<AdminProvider, 'modelCount'>[] }>('/api/admin/providers'),
      apiRequest<{ data: Array<{ providerConnectionId: string }> }>('/api/admin/models'),
    ])
    setProviders(providerResponse.data.map((provider) => ({
      ...provider,
      modelCount: modelResponse.data.filter((model) => model.providerConnectionId === provider.id).length,
    })))
  }

  useEffect(() => { void load() }, [])

  const openAdd = () => {
    setShowKey(false)
    setDraft(emptyDraft())
  }

  const openEdit = (p: AdminProvider) => {
    setShowKey(false)
    setDraft({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.hasApiKey ? '••••••••••••••••' : '',
      cacheAffinityMode: p.cacheAffinityMode,
      cacheAffinityScope: p.cacheAffinityScope,
      cacheIsolationMode: p.cacheIsolationMode,
      cacheIsolationScope: p.cacheIsolationScope,
    })
  }

  const save = async () => {
    if (!draft?.name.trim() || !draft.baseUrl.trim()) return
    if (draft.id) {
      await apiRequest(`/api/admin/providers/${draft.id}`, {
        method: 'PATCH', body: {
          name: draft.name.trim(), baseUrl: draft.baseUrl.trim(),
          cacheAffinityMode: draft.cacheAffinityMode,
          cacheAffinityScope: draft.cacheAffinityScope,
          cacheIsolationMode: draft.cacheIsolationMode,
          cacheIsolationScope: draft.cacheIsolationScope,
          ...(draft.apiKey.replace(/•/g, '').trim() ? { apiKey: draft.apiKey } : {}),
        },
      })
    } else {
      await apiRequest('/api/admin/providers', {
        method: 'POST', body: {
          name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey, requestTimeoutMs: 120_000,
          cacheAffinityMode: draft.cacheAffinityMode,
          cacheAffinityScope: draft.cacheAffinityScope,
          cacheIsolationMode: draft.cacheIsolationMode,
          cacheIsolationScope: draft.cacheIsolationScope,
        },
      })
    }
    await load()
    setDraft(null)
  }

  const remove = async (id: string) => {
    await apiRequest(`/api/admin/providers/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Providers</h2>
        <Badge variant="secondary">{providers.length}</Badge>
        <div className="flex-1" />
        <Button size="sm" onClick={openAdd}>
          <Plus />
          Add provider
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Manage reusable upstream endpoints and API keys.
      </p>

      <Card className="shadow-none">
        <CardContent className="px-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="py-2.5 font-medium">Base URL</th>
                <th className="px-4 py-2.5 font-medium">Linked models</th>
                <th className="px-4 py-2.5 font-medium">API key</th>
                <th className="px-4 py-2.5 font-medium">Prompt cache</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="max-w-[280px] truncate py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {p.baseUrl}
                    </code>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{p.modelCount}</td>
                  <td className="px-4 py-3">
                    <Badge variant={p.hasApiKey ? 'secondary' : 'outline'} className="font-normal">
                      {p.hasApiKey ? 'Configured' : 'Missing'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={p.cacheAffinityMode === 'none' ? 'outline' : 'secondary'} className="font-normal">
                      {p.cacheAffinityMode === 'openai_prompt_cache_key'
                        ? `OpenAI · ${p.cacheAffinityScope}`
                        : p.cacheAffinityMode === 'fireworks_session_affinity'
                          ? `Fireworks · ${p.cacheAffinityScope}`
                          : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Check health"
                        onClick={() => void apiRequest(`/api/admin/providers/${p.id}/health`, { method: 'POST' }).then(load)}
                      >
                        <Activity className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => openEdit(p)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Delete"
                        className="hover:text-destructive"
                        onClick={() => void remove(p.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!providers.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    No providers yet. Add one to reuse it across models.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit provider' : 'Add provider'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="prov-name">Provider name</Label>
                <Input
                  id="prov-name"
                  placeholder="OpenAI Production"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Cache affinity transport</Label>
                  <Select value={draft.cacheAffinityMode} onValueChange={(cacheAffinityMode: CacheAffinityMode) => setDraft({ ...draft, cacheAffinityMode })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Disabled</SelectItem>
                      <SelectItem value="openai_prompt_cache_key">OpenAI prompt_cache_key</SelectItem>
                      <SelectItem value="fireworks_session_affinity">Fireworks x-session-affinity</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Uses a supported request field or header; no arbitrary headers are accepted.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Affinity scope</Label>
                  <Select disabled={draft.cacheAffinityMode === 'none'} value={draft.cacheAffinityScope} onValueChange={(cacheAffinityScope: CacheScope) => setDraft({ ...draft, cacheAffinityScope })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent_run">Agent run / response</SelectItem>
                      <SelectItem value="chat">Chat</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Cache isolation</Label>
                  <Select value={draft.cacheIsolationMode} onValueChange={(cacheIsolationMode: CacheIsolationMode) => setDraft({ ...draft, cacheIsolationMode })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Disabled</SelectItem>
                      <SelectItem value="fireworks_prompt_cache_isolation">Fireworks isolation header</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Isolation scope</Label>
                  <Select disabled={draft.cacheIsolationMode === 'none'} value={draft.cacheIsolationScope} onValueChange={(cacheIsolationScope: CacheScope) => setDraft({ ...draft, cacheIsolationScope })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent_run">Agent run / response</SelectItem>
                      <SelectItem value="chat">Chat</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prov-url">Provider base URL</Label>
                <Input
                  id="prov-url"
                  className="font-mono text-xs"
                  placeholder="https://api.openai.com/v1"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prov-key">Provider API key</Label>
                <div className="relative">
                  <Input
                    id="prov-key"
                    type={showKey ? 'text' : 'password'}
                    className="pr-10 font-mono text-xs"
                    placeholder={draft.id ? 'Leave blank to keep current' : 'sk-…'}
                    value={draft.apiKey}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  />
                  {draft.apiKey && (
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={!draft?.name.trim() || !draft.baseUrl.trim()}
            >
              {draft?.id ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
