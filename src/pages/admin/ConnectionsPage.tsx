import { useState } from 'react'
import { BarChart3, Check, Loader2, Plus, Settings2, X } from 'lucide-react'
import { ADMIN_CONNECTIONS, type AdminConnection } from '@/lib/mock-admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
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
import { Section, SecretField, TextField, Toggle } from '@/components/admin/kit'
import { Switch } from '@/components/ui/switch'

function ConnectionRow({
  conn,
  onConfigure,
  onToggle,
}: {
  conn: AdminConnection
  onConfigure: () => void
  onToggle: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
        {conn.url}
      </code>
      {conn.prefixId && <Badge variant="outline">{conn.prefixId}</Badge>}
      <Badge variant="secondary" className="capitalize">{conn.auth}</Badge>
      <Button size="icon-sm" variant="ghost" onClick={onConfigure} title="Configure">
        <Settings2 className="size-4" />
      </Button>
      <Switch checked={conn.enabled} onCheckedChange={onToggle} />
    </div>
  )
}

export function ConnectionsPage() {
  const [conns, setConns] = useState(ADMIN_CONNECTIONS)
  const [openaiEnabled, setOpenaiEnabled] = useState(true)
  const [ollamaEnabled, setOllamaEnabled] = useState(true)
  const [direct, setDirect] = useState(false)
  const [cache, setCache] = useState(true)
  const [editing, setEditing] = useState<AdminConnection | null>(null)
  const [verify, setVerify] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle')
  // deathgrips usage portal config
  const [usagePortal, setUsagePortal] = useState(true)
  const [usageEndpoint, setUsageEndpoint] = useState('https://monitor.kimi.dev/api/portal')
  const [usageKey, setUsageKey] = useState('')

  const byType = (t: 'openai' | 'ollama') => conns.filter((c) => c.type === t)
  const toggle = (id: string, v: boolean) =>
    setConns((cs) => cs.map((c) => (c.id === id ? { ...c, enabled: v } : c)))

  return (
    <div className="space-y-2">
      <h2 className="mb-4 text-lg font-semibold">Connections</h2>

      <Section title="OpenAI API">
        <Toggle label="Enable OpenAI API" checked={openaiEnabled} onChange={setOpenaiEnabled} />
        {openaiEnabled && (
          <>
            {byType('openai').map((c) => (
              <ConnectionRow
                key={c.id}
                conn={c}
                onConfigure={() => setEditing(c)}
                onToggle={(v) => toggle(c.id, v)}
              />
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditing({
                    id: crypto.randomUUID(),
                    type: 'openai',
                    url: '',
                    auth: 'bearer',
                    key: '',
                    prefixId: '',
                    modelIds: [],
                    enabled: true,
                  })
                }
              >
                <Plus />
                Add connection
              </Button>
            </div>
          </>
        )}
      </Section>

      <Section title="Ollama API">
        <Toggle label="Enable Ollama API" checked={ollamaEnabled} onChange={setOllamaEnabled} />
        {ollamaEnabled && (
          <>
            {byType('ollama').map((c) => (
              <ConnectionRow
                key={c.id}
                conn={c}
                onConfigure={() => setEditing(c)}
                onToggle={(v) => toggle(c.id, v)}
              />
            ))}
            <div>
              <Button variant="outline" size="sm">
                <Plus />
                Add connection
              </Button>
            </div>
          </>
        )}
      </Section>

      <Section title="General">
        <Toggle
          label="Direct connections"
          hint="Allow users to connect to OpenAI-compatible endpoints from the browser."
          checked={direct}
          onChange={setDirect}
        />
        <Toggle label="Cache base model list" checked={cache} onChange={setCache} />
      </Section>

      {/* chat-deathgrips custom: usage portal */}
      <Section title="Usage portal" hint="Custom integration — shows a Usage button in the sidebar that opens each user's monitor dashboard.">
        <Toggle label="Enable usage portal" checked={usagePortal} onChange={setUsagePortal} />
        {usagePortal && (
          <>
            <TextField
              label="Monitor API endpoint"
              value={usageEndpoint}
              onChange={setUsageEndpoint}
              mono
              indent
            />
            <SecretField label="Monitor API key" value={usageKey} onChange={setUsageKey} indent />
            <div className="flex items-center gap-2 pl-4 text-xs text-muted-foreground">
              <BarChart3 className="size-3.5" />
              Sidebar button posts id, email, name and role, then opens the returned URL.
            </div>
          </>
        )}
      </Section>

      {/* add/edit connection */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.url ? 'Edit' : 'Add'} connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label>URL</Label>
              <div className="flex gap-2">
                <Input
                  className="font-mono text-xs"
                  placeholder="https://api.openai.com/v1"
                  defaultValue={editing?.url}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    setVerify('checking')
                    setTimeout(() => setVerify(Math.random() > 0.2 ? 'ok' : 'fail'), 900)
                  }}
                >
                  {verify === 'checking' ? (
                    <Loader2 className="animate-spin" />
                  ) : verify === 'ok' ? (
                    <Check className="text-emerald-500" />
                  ) : verify === 'fail' ? (
                    <X className="text-destructive" />
                  ) : (
                    'Verify'
                  )}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Auth</Label>
                <Select defaultValue={editing?.auth ?? 'bearer'}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['none', 'bearer', 'session', 'oauth', 'entra'].map((a) => (
                      <SelectItem key={a} value={a} className="capitalize">
                        {a === 'entra' ? 'Entra ID' : a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Prefix ID</Label>
                <Input defaultValue={editing?.prefixId} placeholder="or" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>API key</Label>
              <Input type="password" className="font-mono text-xs" placeholder="sk-…" />
            </div>
            <div className="space-y-1.5">
              <Label>Headers (JSON)</Label>
              <Textarea rows={2} className="font-mono text-xs" placeholder="{}" />
            </div>
            <div className="space-y-1.5">
              <Label>Model IDs</Label>
              <Input placeholder="Leave empty to use all models from the endpoint" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editing && !conns.find((c) => c.id === editing.id))
                  setConns((cs) => [...cs, { ...editing, url: editing.url || 'https://api.openai.com/v1' }])
                setEditing(null)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
