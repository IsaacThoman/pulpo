import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Database,
  Info,
  KeyRound,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  User,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettings, type Theme } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { useChat } from '@/stores/chat'
import { useCatalog } from '@/stores/catalog'
import { formatBytes } from '@/lib/attachments'

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'account', label: 'Account', icon: User },
  { id: 'personalization', label: 'Personalization', icon: Sparkles },
  { id: 'interface', label: 'Interface', icon: Monitor },
  { id: 'api', label: 'API keys', icon: KeyRound },
  { id: 'data', label: 'Data controls', icon: Database },
  { id: 'about', label: 'About', icon: Info },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

interface Memory {
  id: string
  content: string
}

interface StorageUsage {
  usedBytes: number
  limitBytes: number
  remainingBytes: number
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ThemePicker() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const opts: { id: Theme; icon: React.ReactNode; label: string }[] = [
    { id: 'light', icon: <Sun className="size-4" />, label: 'Light' },
    { id: 'dark', icon: <Moon className="size-4" />, label: 'Dark' },
    { id: 'system', icon: <Monitor className="size-4" />, label: 'System' },
  ]
  return (
    <div className="flex rounded-lg border p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setTheme(o.id)}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
            theme === o.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<SectionId>('general')
  const s = useSettings()
  const user = useAuth((a) => a.user)
  const logout = useAuth((a) => a.logout)
  const navigate = useNavigate()
  const [memories, setMemories] = useState<Memory[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const models = useCatalog((state) => state.models)
  const [importFallback, setImportFallback] = useState('')
  const [importResult, setImportResult] = useState('')
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)

  const chooseImport = (source: 'pulpo' | 'openwebui') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json'
    input.onchange = () => { const file = input.files?.[0]; if (!file) return; void file.text().then((text) => JSON.parse(text)).then((data) => apiRequest<{ imported: number; duplicates: number; warnings: string[] }>('/api/chats/import', { method: 'POST', body: { source, data, fallbackModelId: importFallback || undefined } })).then((result) => { setImportResult(`Imported ${result.imported}; ${result.duplicates} duplicate(s).${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`); return queryClient.invalidateQueries({ queryKey: ['chats'] }) }).catch((error) => setImportResult(error instanceof Error ? error.message : 'Import failed')) }
    input.click()
  }

  useEffect(() => {
    if (!open || section !== 'personalization') return
    setMemoriesLoading(true)
    void apiRequest<{ data: Memory[] }>('/api/memories')
      .then((result) => setMemories(result.data))
      .finally(() => setMemoriesLoading(false))
  }, [open, section])

  useEffect(() => {
    if (!open || section !== 'data') return
    void apiRequest<StorageUsage>('/api/attachments/usage').then(setStorageUsage)
  }, [open, section])

  const forgetMemory = async (id: string) => {
    await apiRequest(`/api/memories/${id}`, { method: 'DELETE' })
    setMemories((items) => items.filter((memory) => memory.id !== id))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[600px] max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-full">
          {/* nav */}
          <div className="flex w-52 shrink-0 flex-col border-r bg-muted/30 p-3">
            <div className="px-2 pb-2 text-sm font-semibold">Settings</div>
            <div className="space-y-0.5">
              {SECTIONS.filter((sec) => sec.id !== 'api' || useAuth.getState().apiKeysEnabled).map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => setSection(sec.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    section === sec.id
                      ? 'bg-accent font-medium'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <sec.icon className="size-4" />
                  {sec.label}
                </button>
              ))}
            </div>
            {user?.role === 'admin' && (
              <div className="mt-auto border-t pt-3">
                <button
                  onClick={() => {
                    onClose()
                    navigate('/admin')
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  <ShieldCheck className="size-4" />
                  Admin settings
                </button>
              </div>
            )}
          </div>

          {/* content */}
          <ScrollArea className="min-w-0 flex-1">
            <div className="p-6">
              {section === 'general' && (
                <div>
                  <h2 className="text-base font-semibold">General</h2>
                  <Separator className="my-3" />
                  <Row label="Theme" hint="Applies across the whole app.">
                    <ThemePicker />
                  </Row>
                  <Row label="Language">
                    <Select value={s.language} onValueChange={(v) => s.set('language', v)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-US">English (US)</SelectItem>
                        <SelectItem value="en-GB">English (UK)</SelectItem>
                        <SelectItem value="de-DE">Deutsch</SelectItem>
                        <SelectItem value="es-ES">Español</SelectItem>
                        <SelectItem value="zh-CN">中文</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row label="Notifications" hint="Notify when a response finishes in a background tab.">
                    <Switch checked={s.notifications} onCheckedChange={(v) => s.set('notifications', v)} />
                  </Row>
                  <Row label="Send with Enter" hint="When off, Enter adds a newline and Cmd+Enter sends.">
                    <Switch checked={s.sendWithEnter} onCheckedChange={(v) => s.set('sendWithEnter', v)} />
                  </Row>
                </div>
              )}

              {section === 'account' && (
                <div>
                  <h2 className="text-base font-semibold">Account</h2>
                  <Separator className="my-3" />
                  <div className="flex items-center gap-4 py-3">
                    <Avatar className="size-14">
                      <AvatarFallback className="bg-zinc-700 text-lg font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900">
                        {user?.initials ?? '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium">{user?.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {user?.email} · {user?.role}
                      </div>
                    </div>
                    <div className="flex-1" />
                    <Button variant="outline" size="sm">
                      Change avatar
                    </Button>
                  </div>
                  <Row label="Display name">
                    <Input defaultValue={user?.name ?? ''} className="w-52" />
                  </Row>
                  <Row label="Password">
                    <Button variant="outline" size="sm">
                      Change password
                    </Button>
                  </Row>
                  <Separator className="my-3" />
                  <Row label="Sign out" hint="End this session on this device.">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onClose()
                        logout()
                        navigate('/login')
                      }}
                    >
                      Sign out
                    </Button>
                  </Row>
                </div>
              )}

              {section === 'personalization' && (
                <div>
                  <h2 className="text-base font-semibold">Personalization</h2>
                  <Separator className="my-3" />
                  <Row label="Nickname" hint="Shown on the public leaderboard instead of your name.">
                    <Input
                      value={s.nickname}
                      onChange={(e) => s.set('nickname', e.target.value)}
                      placeholder="e.g. deathgrips_fan"
                      className="w-52"
                    />
                  </Row>
                  <div className="py-3">
                    <Label className="text-sm font-medium">Custom instructions</Label>
                    <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                      Appended to every conversation as a system prompt.
                    </p>
                    <Textarea
                      value={s.customInstructions}
                      onChange={(e) => s.set('customInstructions', e.target.value)}
                      placeholder="e.g. Be terse. Prefer code over prose. Never apologize."
                      rows={5}
                    />
                  </div>
                  <div className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label className="text-sm font-medium">Memories</Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Allow Pulpo to remember durable facts from future chats.
                        </p>
                      </div>
                      <Switch
                        checked={s.memoryEnabled}
                        onCheckedChange={(value) => s.set('memoryEnabled', value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      {memoriesLoading && (
                        <div className="pt-2 text-sm text-muted-foreground">Loading memories…</div>
                      )}
                      {!memoriesLoading && memories.length === 0 && (
                        <div className="pt-2 text-sm text-muted-foreground">No saved memories.</div>
                      )}
                      {memories.map((memory) => (
                        <div
                          key={memory.id}
                          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                        >
                          <span>{memory.content}</span>
                          <button
                            type="button"
                            onClick={() => void forgetMemory(memory.id)}
                            className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                          >
                            forget
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {section === 'interface' && (
                <div>
                  <h2 className="text-base font-semibold">Interface</h2>
                  <Separator className="my-3" />
                  <Row label="Chat width">
                    <Select
                      value={s.chatWidth}
                      onValueChange={(v) => s.set('chatWidth', v as 'full' | 'narrow')}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="narrow">Comfortable</SelectItem>
                        <SelectItem value="full">Full width</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row label="Stream responses" hint="Render tokens as they arrive.">
                    <Switch checked={s.streamResponses} onCheckedChange={(v) => s.set('streamResponses', v)} />
                  </Row>
                  <Row label="Show reasoning" hint="Show expandable thought/work activity above assistant replies.">
                    <Switch checked={s.showReasoning} onCheckedChange={(v) => s.set('showReasoning', v)} />
                  </Row>
                  <Row label="Chats kept on this device" hint="Recent chats remain available instantly and while offline (0–500).">
                    <Input className="w-28" type="number" min={0} max={500} value={s.localChatLimit} onChange={(event) => s.set('localChatLimit', Math.min(500, Math.max(0, Number(event.target.value))))} />
                  </Row>
                  <Row label="Attachment cache" hint="Maximum file data retained on this device for offline chats.">
                    <div className="flex items-center gap-2">
                      <Input className="w-24" type="number" min={0} max={2048} step={10} value={s.localAttachmentCacheMb} onChange={(event) => s.set('localAttachmentCacheMb', Math.min(2048, Math.max(0, Number(event.target.value))))} />
                      <span className="text-xs text-muted-foreground">MB</span>
                    </div>
                  </Row>
                </div>
              )}

              {section === 'api' && (
                <div>
                  <h2 className="text-base font-semibold">API keys</h2>
                  <Separator className="my-3" />
                  <p className="py-2 text-sm text-muted-foreground">{useAuth.getState().apiKeysEnabled ? 'Create OpenAI-compatible API keys for scripts and third-party tools. Keys are managed on the dedicated API page.' : 'API keys are disabled by the administrator. Existing keys are retained but cannot authenticate until the policy is re-enabled.'}</p>
                  <Button
                    disabled={!useAuth.getState().apiKeysEnabled}
                    onClick={() => {
                      onClose()
                      navigate('/api-keys')
                    }}
                  >
                    <KeyRound />
                    Manage API keys
                  </Button>
                </div>
              )}

              {section === 'data' && (
                <div>
                  <h2 className="text-base font-semibold">Data controls</h2>
                  <Separator className="my-3" />
                  <div className="mb-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">File storage</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {storageUsage ? `${formatBytes(storageUsage.usedBytes)} of ${formatBytes(storageUsage.limitBytes)}` : 'Loading…'}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${storageUsage?.limitBytes ? Math.min(100, storageUsage.usedBytes / storageUsage.limitBytes * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">Uploaded files and files created by models count toward this allowance.</p>
                  </div>
                  <Row label="Export chats" hint="Download all conversations as JSON.">
                    <Button variant="outline" size="sm" onClick={() => location.assign('/api/chats/export')}>
                      Export
                    </Button>
                  </Row>
                  <Row label="Fallback model" hint="Used when an imported source model is unavailable."><Select value={importFallback} onValueChange={setImportFallback}><SelectTrigger className="w-44"><SelectValue placeholder="Select if needed" /></SelectTrigger><SelectContent>{models.filter((model) => model.enabled).map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent></Select></Row>
                  <Row label="Import Pulpo chats" hint="Accepts portable v2 and legacy v1 exports."><Button variant="outline" size="sm" onClick={() => chooseImport('pulpo')}>Import</Button></Row>
                  <Row label="Import chats from OpenWebUI" hint="Preserves history branches, timestamps, titles, and pinned state."><Button variant="outline" size="sm" onClick={() => chooseImport('openwebui')}>Import OpenWebUI</Button></Row>
                  {importResult && <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">{importResult}</div>}
                  <Row label="Delete all chats" hint="This cannot be undone.">
                    <Button variant="destructive" size="sm" onClick={() => {
                      if (!confirm('Delete every chat in your Pulpo account?')) return
                      void apiRequest('/api/chats', { method: 'DELETE' }).then(() => {
                        useChat.setState({ chats: [], activeChatId: null })
                        return queryClient.invalidateQueries({ queryKey: ['chats'] })
                      })
                    }}>
                      Delete all
                    </Button>
                  </Row>
                </div>
              )}

              {section === 'about' && (
                <div>
                  <h2 className="text-base font-semibold">About</h2>
                  <Separator className="my-3" />
                  <div className="space-y-2 py-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono">0.1.0</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">API endpoint</span>
                      <span className="font-mono text-xs">{location.origin}/v1</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
