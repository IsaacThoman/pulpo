import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { InstructionPreset } from '@pulpo/contracts'
import {
  Database,
  Camera,
  Info,
  KeyRound,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  User,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModelIcon } from '@/components/ModelIcon'
import { useSettings, type AutomaticChatExpiration, type Theme, type TrashRetention } from '@/stores/settings'
import { useAuth, type AuthUser } from '@/stores/auth'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { useChat } from '@/stores/chat'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { formatBytes } from '@/lib/attachments'
import { formatDateTime, timeAgo } from '@/lib/format'
import { clearLocalChats } from '@/lib/local-first/chat-cache'
import { automaticProfileColor, PROFILE_COLORS } from '@/lib/profile'
import { PasswordSettings } from './PasswordSettings'
import { PasskeySettings } from './PasskeySettings'
import { TwoFactorSettings } from './TwoFactorSettings'
import { UsernameSettings } from './UsernameSettings'
import { AvatarCropEditor } from './AvatarCropEditor'
import { DEFAULT_AVATAR_CROP, prepareAvatarFile } from './avatar-crop'
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from './settings-dialog'
import { InstructionPresetButtons } from './InstructionPresetButtons'

const SECTION_CONFIG = {
  general: { label: 'General', icon: SlidersHorizontal },
  profile: { label: 'Profile', icon: User },
  security: { label: 'Security', icon: ShieldCheck },
  personalization: { label: 'Personalization', icon: Sparkles },
  interface: { label: 'Interface', icon: Monitor },
  api: { label: 'API keys', icon: KeyRound },
  data: { label: 'Data controls', icon: Database },
  trash: { label: 'Trash', icon: Trash2 },
  about: { label: 'About', icon: Info },
} as const satisfies Record<SettingsSectionId, { label: string; icon: typeof User }>

const SECTIONS = SETTINGS_SECTION_IDS.map((id) => ({ id, ...SECTION_CONFIG[id] }))

interface Memory {
  id: string
  content: string
}

interface StorageUsage {
  usedBytes: number
  limitBytes: number
  remainingBytes: number
}

interface DeletedChat {
  id: string
  title: string
  modelId: string
  deletedAt: string
  purgeAt: string | null
}

const TRASH_RETENTION_LABELS: Record<TrashRetention, string> = {
  instant: 'No retention',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  indefinite: 'Indefinitely',
}

function trashTrashedLabel(iso: string): string {
  return `Trashed ${timeAgo(new Date(iso).getTime())}`
}

function trashDeletesLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Kept indefinitely'
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'Deletes now'
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `Deletes in ${minutes}m`
  const hours = Math.ceil(ms / 3_600_000)
  if (hours < 24) return `Deletes in ${hours}h`
  const days = Math.ceil(ms / 86_400_000)
  return `Deletes in ${days}d`
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 self-start sm:shrink-0 sm:self-auto">{children}</div>
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
    <div className="flex w-full rounded-lg border p-0.5 sm:w-auto">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setTheme(o.id)}
          className={cn(
            'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors sm:flex-none sm:px-3',
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

export function SettingsModal({
  open,
  initialSection = 'general',
  onClose,
}: {
  open: boolean
  initialSection?: SettingsSectionId
  onClose: () => void
}) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection)
  const s = useSettings()
  const user = useAuth((a) => a.user)
  const logout = useAuth((a) => a.logout)
  const replaceUser = useAuth((a) => a.replaceUser)
  const navigate = useNavigate()
  const [memories, setMemories] = useState<Memory[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const models = useCatalog((state) => state.models)
  const [importFallback, setImportFallback] = useState('')
  const [importResult, setImportResult] = useState('')
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [trashRetentionSaving, setTrashRetentionSaving] = useState(false)
  const [trashRetentionError, setTrashRetentionError] = useState('')
  const [trashNow, setTrashNow] = useState(() => Date.now())
  const [profileName, setProfileName] = useState(user?.name ?? '')
  const [profileColor, setProfileColor] = useState(() => user?.profileColor ?? automaticProfileColor(user?.id ?? 'pulpo-user'))
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [avatarCandidate, setAvatarCandidate] = useState<{ file: File; url: string } | null>(null)
  const [avatarCrop, setAvatarCrop] = useState(DEFAULT_AVATAR_CROP)
  const [customColorSelected, setCustomColorSelected] = useState(() => Boolean(
    user?.profileColor && !PROFILE_COLORS.some((color) => color === user.profileColor),
  ))
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const deletedChatsQueryKey = ['deleted-chats', user?.id] as const
  const deletedChatsQuery = useQuery({
    queryKey: deletedChatsQueryKey,
    queryFn: () => apiRequest<{ data: DeletedChat[] }>('/api/chats/deleted').then((result) => result.data),
    enabled: Boolean(open && section === 'trash' && user?.id && s.trashRetention !== 'instant'),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  })
  const deletedChats = deletedChatsQuery.data ?? []
  const personalizationQuery = useQuery({
    queryKey: ['settings', user?.id],
    queryFn: () => apiRequest<{ values: Record<string, unknown>; instructionPresets: InstructionPreset[] }>('/api/settings'),
    enabled: Boolean(open && section === 'personalization' && user?.id),
  })
  const instructionPresets = personalizationQuery.data?.instructionPresets ?? []

  useEffect(() => {
    if (open) setSection(initialSection)
  }, [initialSection, open])

  useEffect(() => {
    if (!open || !user) return
    setProfileName(user.name)
    setProfileColor(user.profileColor ?? automaticProfileColor(user.id))
    setCustomColorSelected(Boolean(user.profileColor && !PROFILE_COLORS.some((color) => color === user.profileColor)))
    setProfileError('')
  }, [open, user])

  useEffect(() => { if (!open) setProfileMessage('') }, [open])

  useEffect(() => () => { if (avatarCandidate) URL.revokeObjectURL(avatarCandidate.url) }, [avatarCandidate])

  const profileDirty = Boolean(user) && (
    profileName.trim() !== user!.name
    || profileColor !== (user!.profileColor ?? automaticProfileColor(user!.id))
  )
  const profileColorIsPreset = PROFILE_COLORS.some((color) => color === profileColor)

  const saveProfile = async () => {
    setProfileSaving(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const result = await apiRequest<{ user: Omit<AuthUser, 'initials'> }>('/api/me', {
        method: 'PATCH',
        body: { name: profileName, profileColor },
      })
      replaceUser(result.user)
      setProfileMessage('Profile saved.')
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Could not save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const uploadAvatar = async () => {
    if (!avatarCandidate) return
    setProfileSaving(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const body = new FormData()
      body.append('file', await prepareAvatarFile(avatarCandidate.file, avatarCrop))
      const result = await apiRequest<{ user: Omit<AuthUser, 'initials'> }>('/api/me/avatar', { method: 'PUT', body })
      replaceUser(result.user)
      setAvatarCandidate(null)
      setProfileMessage('Profile picture updated.')
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Could not upload profile picture')
    } finally {
      setProfileSaving(false)
    }
  }

  const removeAvatar = async () => {
    setProfileSaving(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const result = await apiRequest<{ user: Omit<AuthUser, 'initials'> }>('/api/me/avatar', { method: 'DELETE' })
      replaceUser(result.user)
      setProfileMessage('Profile picture removed.')
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Could not remove profile picture')
    } finally {
      setProfileSaving(false)
    }
  }

  useEffect(() => {
    if (!open || section !== 'trash' || s.trashRetention === 'instant') return
    setTrashNow(Date.now())
    const id = window.setInterval(() => setTrashNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [open, section, s.trashRetention])

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

  const recoverChat = async (id: string) => {
    await apiRequest(`/api/chats/${id}/recover`, { method: 'POST' })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['chats'] }),
      queryClient.invalidateQueries({ queryKey: deletedChatsQueryKey }),
    ])
  }

  const permanentlyDeleteChat = async (chat: DeletedChat) => {
    if (!confirm(`Permanently delete “${chat.title}”? This cannot be undone.`)) return
    await apiRequest(`/api/chats/${chat.id}/permanent`, { method: 'DELETE' })
    await queryClient.invalidateQueries({ queryKey: deletedChatsQueryKey })
  }

  const permanentlyDeleteAll = async () => {
    if (!deletedChats.length || !confirm('Permanently delete every chat in trash? This cannot be undone.')) return
    await apiRequest('/api/chats/deleted', { method: 'DELETE' })
    await queryClient.invalidateQueries({ queryKey: deletedChatsQueryKey })
  }

  const updateTrashRetention = async (value: TrashRetention) => {
    const previous = s.trashRetention
    s.set('trashRetention', value)
    setTrashRetentionSaving(true)
    setTrashRetentionError('')
    try {
      await apiRequest('/api/settings', { method: 'PATCH', body: { trashRetention: value } })
      if (value === 'instant' && user?.id) {
        void clearLocalChats(user.id, deletedChats.map((chat) => chat.id)).catch(() => undefined)
        queryClient.removeQueries({ queryKey: deletedChatsQueryKey, exact: true })
      } else {
        await queryClient.invalidateQueries({ queryKey: deletedChatsQueryKey })
      }
    } catch (error) {
      s.set('trashRetention', previous)
      setTrashRetentionError(error instanceof Error ? error.message : 'Could not save trash retention')
    } finally {
      setTrashRetentionSaving(false)
    }
  }

  const deleteAllChats = async () => {
    const message = s.trashRetention === 'instant'
      ? 'Permanently delete every chat in your Pulpo account? This cannot be undone.'
      : 'Move every chat in your Pulpo account to trash?'
    if (!confirm(message)) return
    await apiRequest('/api/chats', { method: 'DELETE' })
    const chatIds = useChat.getState().chats.map((chat) => chat.id)
    useChat.setState({ chats: [], activeChatId: null, activeTemporaryChatId: null })
    if (s.trashRetention === 'instant' && user?.id) {
      void clearLocalChats(user.id, chatIds).catch(() => undefined)
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['chats'] }),
      queryClient.invalidateQueries({ queryKey: deletedChatsQueryKey }),
    ])
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[min(680px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:h-[600px] sm:max-h-[85vh] sm:max-w-[calc(100%-2rem)] lg:max-w-3xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden sm:flex-row">
          {/* nav */}
          <div className="flex w-full shrink-0 flex-col border-b bg-muted/30 p-2 sm:w-52 sm:border-r sm:border-b-0 sm:p-3">
            <div className="px-2 pb-1.5 pr-8 text-sm font-semibold sm:pb-2 sm:pr-2">Settings</div>
            <div className="settings-section-nav flex gap-1 overflow-x-auto pb-0.5 sm:block sm:space-y-0.5 sm:overflow-visible sm:pb-0">
              {SECTIONS.filter((sec) => sec.id !== 'api' || useAuth.getState().apiKeysEnabled).map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => setSection(sec.id)}
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors sm:w-full sm:gap-2.5',
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
              <div className="mt-auto hidden border-t pt-3 sm:block">
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
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="p-4 sm:p-6">
              {section === 'trash' && (
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">Trash</h2>
                  <Separator className="my-3" />
                  <Row label="Trash retention period" hint="How long trashed chats stay recoverable before permanent deletion.">
                    <Select value={s.trashRetention} disabled={trashRetentionSaving} onValueChange={(value) => void updateTrashRetention(value as TrashRetention)}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.entries(TRASH_RETENTION_LABELS) as [TrashRetention, string][]).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                  {trashRetentionError && <p className="text-right text-xs text-destructive">{trashRetentionError}</p>}
                  <Separator className="my-3" />
                  <div className="flex min-w-0 items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Trashed chats</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {s.trashRetention === 'instant'
                          ? 'Chats are permanently deleted immediately.'
                          : deletedChatsQuery.isLoading
                            ? 'Loading…'
                            : deletedChats.length
                              ? `${deletedChats.length} chat${deletedChats.length === 1 ? '' : 's'}`
                              : 'Recover chats or permanently delete them.'}
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      disabled={!deletedChats.length || s.trashRetention === 'instant'}
                      onClick={() => void permanentlyDeleteAll()}
                    >
                      Empty trash
                    </Button>
                  </div>
                  {s.trashRetention === 'instant' ? null : deletedChatsQuery.isLoading ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading trashed chats…</p>
                  ) : deletedChatsQuery.error ? (
                    <div className="py-8 text-center text-sm text-destructive">
                      <p>{deletedChatsQuery.error instanceof Error ? deletedChatsQuery.error.message : 'Could not load trashed chats'}</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => void deletedChatsQuery.refetch()}>Try again</Button>
                    </div>
                  ) : !deletedChats.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Trash is empty.</p>
                  ) : (
                    <div className="min-w-0 divide-y">
                      {deletedChats.map((chat) => {
                        const deletedTs = new Date(chat.deletedAt).getTime()
                        const purgeTs = chat.purgeAt ? new Date(chat.purgeAt).getTime() : null
                        return (
                          <div key={chat.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 py-2.5">
                            <ModelIcon
                              model={getCatalogModel(chat.modelId)}
                              className="size-4 shrink-0 rounded-[2px]"
                            />
                            <div className="min-w-0 overflow-hidden">
                              <div className="truncate text-sm font-medium">{chat.title}</div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                <span title={formatDateTime(deletedTs)}>{trashTrashedLabel(chat.deletedAt)}</span>
                                <span aria-hidden className="text-muted-foreground/50"> · </span>
                                <span title={purgeTs ? formatDateTime(purgeTs) : undefined}>
                                  {trashDeletesLabel(chat.purgeAt, trashNow)}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => void recoverChat(chat.id)}>
                                Recover
                              </Button>
                              <Button variant="destructive" size="sm" onClick={() => void permanentlyDeleteChat(chat)}>
                                Delete
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

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
                </div>
              )}

              {section === 'profile' && (
                <div>
                  <h2 className="text-base font-semibold">Profile</h2>
                  <Separator className="my-3" />
                  <div className="flex flex-wrap items-start gap-4 py-3">
                    <div className="flex shrink-0 flex-col items-center">
                      <button
                        type="button"
                        aria-label="Change profile picture"
                        disabled={profileSaving}
                        className="group relative size-14 cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <ProfileAvatar name={user?.name ?? 'Pulpo user'} avatarUrl={user?.avatarUrl} className="size-14" fallbackClassName="text-lg" />
                        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                          <Camera className="size-4" />
                          <span className="text-[9px] font-medium leading-none">Change</span>
                        </span>
                      </button>
                      {user?.avatarUrl && <button
                        type="button"
                        disabled={profileSaving}
                        className="mt-1 cursor-pointer text-[10px] leading-none text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void removeAvatar()}
                      >Remove</button>}
                    </div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        if (file) {
                          setProfileMessage('')
                          setAvatarCrop(DEFAULT_AVATAR_CROP)
                          setAvatarCandidate({ file, url: URL.createObjectURL(file) })
                        }
                        event.currentTarget.value = ''
                      }}
                    />
                    <div className="flex h-14 min-w-0 flex-col justify-center">
                      <span className="truncate font-medium">{user?.name}</span>
                      {user?.username && <span className="truncate text-sm text-muted-foreground">@{user.username}</span>}
                    </div>
                    <div className="flex-1" />
                    <div className="flex h-14 items-center">
                      <UsernameSettings buttonOnly />
                    </div>
                  </div>
                  {avatarCandidate && <div className="mb-3 rounded-lg border bg-muted/20 p-3">
                    <AvatarCropEditor imageUrl={avatarCandidate.url} settings={avatarCrop} onChange={setAvatarCrop} />
                    <div className="mt-3 flex justify-end gap-2"><Button size="sm" disabled={profileSaving} onClick={() => void uploadAvatar()}>Use picture</Button><Button size="sm" variant="outline" disabled={profileSaving} onClick={() => setAvatarCandidate(null)}>Cancel</Button></div>
                  </div>}
                  <Row label="Display name"><Input value={profileName} onChange={(event) => { setProfileMessage(''); setProfileName(event.target.value) }} maxLength={120} className="w-52" /></Row>
                  <Row label="Friends chart color" hint="Used on accepted friends’ usage charts."><div className="flex flex-wrap items-center justify-end gap-2">
                    {PROFILE_COLORS.map((color) => <button
                      key={color}
                      type="button"
                      aria-label={`Profile color ${color}`}
                      className={cn('size-5 cursor-pointer rounded border', !customColorSelected && profileColor === color && 'ring-2 ring-foreground ring-offset-2 ring-offset-background')}
                      style={{ backgroundColor: color }}
                      onClick={() => { setProfileMessage(''); setCustomColorSelected(false); setProfileColor(color) }}
                    />)}
                    <div className="relative size-5 shrink-0">
                      <input
                        type="color"
                        aria-label="Choose a custom profile color"
                        value={profileColor}
                        className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                        onPointerDown={() => setCustomColorSelected(true)}
                        onClick={() => setCustomColorSelected(true)}
                        onChange={(event) => { setProfileMessage(''); setCustomColorSelected(true); setProfileColor(event.currentTarget.value) }}
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none absolute inset-0 rounded border bg-clip-padding',
                          !customColorSelected
                            ? 'peer-focus-visible:ring-2 peer-focus-visible:ring-foreground peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background'
                            : 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                        )}
                        style={profileColorIsPreset
                          ? { backgroundImage: 'conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }
                          : { backgroundColor: profileColor }}
                      />
                    </div>
                  </div></Row>
                  <div className="flex min-h-10 items-center justify-end gap-3 py-2">
                    {profileError && <span className="mr-auto text-sm text-destructive">{profileError}</span>}
                    {!profileError && profileMessage && <span className="mr-auto text-sm text-muted-foreground">{profileMessage}</span>}
                    <Button size="sm" disabled={!profileDirty || profileSaving || !profileName.trim()} onClick={() => void saveProfile()}>{profileSaving ? 'Saving…' : 'Save profile'}</Button>
                  </div>
                </div>
              )}

              {section === 'security' && (
                <div>
                  <h2 className="text-base font-semibold">Security</h2>
                  <Separator className="my-3" />
                  <Row label="Email" hint="Used to sign in to your account.">
                    <span className="block max-w-64 truncate text-sm text-muted-foreground">{user?.email}</span>
                  </Row>
                  <PasswordSettings />
                  <PasskeySettings />
                  <TwoFactorSettings />
                  <Separator className="my-3" />
                  <Row label="Sign out" hint="End this session on this device.">
                    <Button variant="outline" size="sm" onClick={() => { onClose(); logout(); navigate('/login') }}>Sign out</Button>
                  </Row>
                </div>
              )}

              {section === 'personalization' && (
                <div>
                  <h2 className="text-base font-semibold">Personalization</h2>
                  <Separator className="my-3" />
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
                    {instructionPresets.length > 0 && (
                      <div className="mt-3">
                        <InstructionPresetButtons
                          presets={instructionPresets}
                          selections={s.instructionPresetSelections}
                          onToggle={(presetId, enabled) => s.set('instructionPresetSelections', {
                            ...s.instructionPresetSelections,
                            [presetId]: enabled,
                          })}
                        />
                      </div>
                    )}
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
                  <Row label="Downloaded attachment cache" hint="Maximum file data retained after you upload or explicitly download a file.">
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
                  <Row label="Automatic chat expiration" hint="Move chats to Trash automatically unless saved within the selected period.">
                    <Select
                      value={s.automaticChatExpiration}
                      onValueChange={(value) => s.set('automaticChatExpiration', value as AutomaticChatExpiration)}
                    >
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">Disabled</SelectItem>
                        <SelectItem value="24h">24 hours</SelectItem>
                        <SelectItem value="7d">7 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                  <div className="py-3">
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
                  <Row label="Import Pulpo chats"><Button variant="outline" size="sm" onClick={() => chooseImport('pulpo')}>Import</Button></Row>
                  <Row label="Import chats from OpenWebUI" hint="Preserves history branches, timestamps, titles, and pinned state."><Button variant="outline" size="sm" onClick={() => chooseImport('openwebui')}>Import OpenWebUI</Button></Row>
                  {importResult && <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">{importResult}</div>}
                  <Separator className="my-3" />
                  <Row
                    label="Trash all chats"
                    hint={s.trashRetention === 'instant'
                      ? 'Permanently deletes every chat.'
                      : s.trashRetention === 'indefinite'
                        ? 'Moves every conversation to trash. (no automatic permanent deletion)'
                        : `Moves every conversation to trash. (delete in ${TRASH_RETENTION_LABELS[s.trashRetention].toLowerCase()})`}
                  >
                    <Button variant="destructive" size="sm" disabled={trashRetentionSaving} onClick={() => void deleteAllChats()}>Trash all chats</Button>
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
