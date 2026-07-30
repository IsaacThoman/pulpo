import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AudioLines,
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
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'account', label: 'Account', icon: User },
  { id: 'personalization', label: 'Personalization', icon: Sparkles },
  { id: 'interface', label: 'Interface', icon: Monitor },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'api', label: 'API keys', icon: KeyRound },
  { id: 'data', label: 'Data controls', icon: Database },
  { id: 'about', label: 'About', icon: Info },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

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
  const navigate = useNavigate()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[600px] max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-full">
          {/* nav */}
          <div className="flex w-52 shrink-0 flex-col border-r bg-muted/30 p-3">
            <div className="px-2 pb-2 text-sm font-semibold">Settings</div>
            <div className="space-y-0.5">
              {SECTIONS.map((sec) => (
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
                        IT
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium">Isaac Thoman</div>
                      <div className="text-sm text-muted-foreground">isaac@pulpo.dev · admin</div>
                    </div>
                    <div className="flex-1" />
                    <Button variant="outline" size="sm">
                      Change avatar
                    </Button>
                  </div>
                  <Row label="Display name">
                    <Input defaultValue="Isaac Thoman" className="w-52" />
                  </Row>
                  <Row label="Password">
                    <Button variant="outline" size="sm">
                      Change password
                    </Button>
                  </Row>
                  <Row label="Usage portal link" hint="Passwordless link to your personal usage dashboard.">
                    <Button variant="outline" size="sm" onClick={() => { onClose(); navigate('/usage') }}>
                      Open usage
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
                    <Label className="text-sm font-medium">Memories</Label>
                    <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                      Facts pulpo has remembered across chats.
                    </p>
                    <div className="space-y-1.5">
                      {['Prefers zustand over redux', 'Uses pnpm on personal projects', 'Lives in EST'].map(
                        (m) => (
                          <div
                            key={m}
                            className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                          >
                            {m}
                            <button className="cursor-pointer text-xs text-muted-foreground hover:text-destructive">
                              forget
                            </button>
                          </div>
                        )
                      )}
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
                  <Row label="Show reasoning" hint="Expandable thinking blocks for reasoning models.">
                    <Switch checked={s.showReasoning} onCheckedChange={(v) => s.set('showReasoning', v)} />
                  </Row>
                  <Row label="Haptics" hint="Subtle vibration on mobile when a reply lands.">
                    <Switch checked={s.haptics} onCheckedChange={(v) => s.set('haptics', v)} />
                  </Row>
                </div>
              )}

              {section === 'audio' && (
                <div>
                  <h2 className="text-base font-semibold">Audio</h2>
                  <Separator className="my-3" />
                  <Row label="Speech-to-text">
                    <Select defaultValue="whisper">
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whisper">Whisper (local)</SelectItem>
                        <SelectItem value="web">Browser API</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                </div>
              )}

              {section === 'api' && (
                <div>
                  <h2 className="text-base font-semibold">API keys</h2>
                  <Separator className="my-3" />
                  <p className="py-2 text-sm text-muted-foreground">
                    Create OpenAI-compatible API keys for scripts and third-party tools. Keys are
                    managed on the dedicated API page.
                  </p>
                  <Button
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
                  <Row label="Export chats" hint="Download all conversations as JSON.">
                    <Button variant="outline" size="sm">
                      Export
                    </Button>
                  </Row>
                  <Row label="Import chats" hint="Restore from a previous export.">
                    <Button variant="outline" size="sm">
                      Import
                    </Button>
                  </Row>
                  <Row label="Archive all chats">
                    <Button variant="outline" size="sm">
                      Archive all
                    </Button>
                  </Row>
                  <Row label="Delete all chats" hint="This cannot be undone.">
                    <Button variant="destructive" size="sm">
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
                      <span className="font-mono">0.1.0-mock</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Stack</span>
                      <span>react · vite · tailwind · shadcn · zustand</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">API endpoint</span>
                      <span className="font-mono text-xs">https://api.pulpo.dev/v1</span>
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
