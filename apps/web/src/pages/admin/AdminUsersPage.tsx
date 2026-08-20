import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Pencil, Plus, RefreshCw, Search, ShieldOff, Trash2 } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { formatBalance, formatDate, timeAgo } from '@/lib/format'
import type { MonitorUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProfileAvatar } from '@/components/ProfileAvatar'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface AdminBillingUser {
  userId: string
  plan: 'baby' | 'eight' | 'fat'
  weeklyLimitMicros: number
  weeklySpentMicros: number
  weeklyRemainingMicros: number
  weeklyLimitOverridden: boolean
  storageLimitBytes: number
  storageLimitOverridden: boolean
  hold: { holdAt: string; holdReason: string | null; holdReference: string | null } | null
}

export function AdminUsersPage() {
  const users = useUsage((s) => s.users)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<MonitorUser | null>(null)
  const [promoteUser, setPromoteUser] = useState<MonitorUser | null>(null)
  const [resetTwoFactorUser, setResetTwoFactorUser] = useState<MonitorUser | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)
  const [resettingTwoFactor, setResettingTwoFactor] = useState(false)
  const currentUserId = useAuth((state) => state.user?.id)
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const loadAdmin = useUsage((s) => s.loadAdmin)
  useEffect(() => { void loadAdmin() }, [loadAdmin])
  const billingUsersQuery = useQuery({
    queryKey: ['admin-billing-users'],
    queryFn: () => apiRequest<{ data: AdminBillingUser[] }>('/api/admin/billing/users'),
    enabled: billingEnabled,
  })
  const billingByUser = new Map(billingUsersQuery.data?.data.map((row) => [row.userId, row]) ?? [])

  const patchUser = async (id: string, patch: Record<string, unknown>) => {
    await apiRequest(`/api/admin/users/${id}`, { method: 'PATCH', body: patch })
    await loadAdmin()
  }

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.username.toLowerCase().includes(query.replace(/^@/, '').toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase())
  )
  const adminTwoFactorEnabled = users.find((user) => user.id === currentUserId)?.twoFactorEnabled ?? false

  const resetTwoFactor = async () => {
    if (!resetTwoFactorUser) return
    setResettingTwoFactor(true)
    setTwoFactorError(null)
    try {
      await apiRequest(`/api/admin/users/${resetTwoFactorUser.id}/two-factor/reset`, {
        method: 'POST', body: adminTwoFactorEnabled ? { verificationCode: twoFactorCode } : {},
      })
      setResetTwoFactorUser(null)
      setTwoFactorCode('')
      await loadAdmin()
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'Could not reset two-factor authentication.')
    } finally {
      setResettingTwoFactor(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Users</h2>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-52 pl-8"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus />
          Add user
        </Button>
      </div>

      <Card className="shadow-none">
        <CardContent className="overflow-x-auto px-0 py-0">
          <table className="data-table min-w-max">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Display name</th>
                <th className="px-3 py-2">Email</th>
                {billingEnabled && <th className="px-3 py-2">Plan</th>}
                {billingEnabled && <th className="px-3 py-2 text-right">Weekly limit</th>}
                {billingEnabled && <th className="px-3 py-2 text-right">Invites</th>}
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-right">File storage</th>
                <th className="px-3 py-2">Last active</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">
                    <Select value={u.role} onValueChange={(role) => {
                      if (role === 'admin' && u.role !== 'admin') setPromoteUser(u)
                      else void patchUser(u.id, { role })
                    }}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="user">user</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <ProfileAvatar name={u.name} avatarUrl={u.avatarUrl} className="size-6" fallbackClassName="text-[9px]" />
                      <span>{u.name}<span className="ml-1.5 text-xs text-muted-foreground">@{u.username}</span></span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                  {billingEnabled && <td className="px-3 py-2"><BillingPlanCell row={billingByUser.get(u.id)} /></td>}
                  {billingEnabled && <td className="px-3 py-2 text-right tabular-nums"><WeeklyLimitCell row={billingByUser.get(u.id)} onChanged={() => void billingUsersQuery.refetch()} /></td>}
                  {billingEnabled && <td className="px-3 py-2 text-right tabular-nums"><InviteQuotaCell user={u} onChanged={() => void loadAdmin()} /></td>}
                  <td className="px-3 py-2 text-right tabular-nums">
                    <BalanceCell user={u} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <StorageCell user={u} row={billingByUser.get(u.id)} onChanged={() => void Promise.all([loadAdmin(), billingUsersQuery.refetch()])} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.lastActiveAt ? timeAgo(u.lastActiveAt) : 'Never'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(u.joinedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {billingEnabled && billingByUser.get(u.id)?.hold && <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Clear billing hold"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          const note = prompt('Reconciliation note required to clear this billing hold:')
                          if (!note?.trim()) return
                          void apiRequest(`/api/admin/billing/users/${u.id}/clear-hold`, { method: 'POST', body: { note } })
                            .then(() => billingUsersQuery.refetch())
                        }}
                      ><AlertTriangle className="size-3.5" /></Button>}
                      {u.twoFactorEnabled && u.id !== currentUserId && <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Reset two-factor authentication"
                        className="hover:text-destructive"
                        onClick={() => { setTwoFactorError(null); setTwoFactorCode(''); setResetTwoFactorUser(u) }}
                      >
                        <ShieldOff className="size-3.5" />
                      </Button>}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => setEditUser(u)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Delete"
                        className="hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete ${u.email}? This cannot be undone.`)) {
                            void apiRequest(`/api/admin/users/${u.id}`, { method: 'DELETE' }).then(loadAdmin)
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* add user */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={(event) => {
            event.preventDefault()
            const values = new FormData(event.currentTarget)
            void apiRequest('/api/admin/users', { method: 'POST', body: {
              role: values.get('role'), name: values.get('name'), username: values.get('username'), email: values.get('email'), password: values.get('password'),
            }}).then(() => { setAddOpen(false); return loadAdmin() })
          }} className="contents">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select name="role" defaultValue="user">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">pending</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input name="name" placeholder="Display name" required />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input name="username" placeholder="username" minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{1,28}[a-z0-9]" required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input name="email" type="email" placeholder="name@example.com" required />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input name="password" type="password" minLength={8} placeholder="Temporary password" required />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Create</Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!promoteUser} onOpenChange={(open) => !open && setPromoteUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Promote user to administrator?</DialogTitle>
            <DialogDescription>
              {promoteUser?.email} will gain full administrative access to this Pulpo instance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteUser(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!promoteUser) return
              void patchUser(promoteUser.id, { role: 'admin' }).then(() => setPromoteUser(null))
            }}>Promote to admin</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTwoFactorUser} onOpenChange={(open) => {
        if (!open && !resettingTwoFactor) { setResetTwoFactorUser(null); setTwoFactorCode(''); setTwoFactorError(null) }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset two-factor authentication?</DialogTitle>
            <DialogDescription>
              This will disable two-factor authentication for {resetTwoFactorUser?.email} and sign them out of all active sessions.
            </DialogDescription>
          </DialogHeader>
          {adminTwoFactorEnabled && <div className="space-y-1.5">
            <Label htmlFor="admin-two-factor-code">Your authenticator or recovery code</Label>
            <Input
              id="admin-two-factor-code"
              autoFocus
              autoComplete="one-time-code"
              className="font-mono"
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value.toUpperCase())}
            />
          </div>}
          {twoFactorError && <p className="text-sm text-destructive">{twoFactorError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={resettingTwoFactor} onClick={() => setResetTwoFactorUser(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={resettingTwoFactor || (adminTwoFactorEnabled && twoFactorCode.trim().length < 6)}
              onClick={() => void resetTwoFactor()}
            >
              {resettingTwoFactor ? 'Resetting…' : 'Reset 2FA'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit user */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={(event) => {
            event.preventDefault()
            if (!editUser) return
            const values = new FormData(event.currentTarget)
            const password = String(values.get('password') ?? '')
            void patchUser(editUser.id, {
              name: values.get('name'), username: values.get('username'), email: values.get('email'),
              ...(billingEnabled ? { inviteCodeQuota: Number(values.get('inviteCodeQuota') ?? 0) } : {}),
              ...(password ? { password } : {}),
            }).then(() => setEditUser(null))
          }} className="contents">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Joined {editUser && formatDate(editUser.joinedAt)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input name="name" defaultValue={editUser?.name} required />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input name="username" defaultValue={editUser?.username} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{1,28}[a-z0-9]" required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input name="email" type="email" defaultValue={editUser?.email} required />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input name="password" type="password" minLength={8} placeholder="Leave blank to keep" />
            </div>
            {billingEnabled && (
              <div className="space-y-1.5">
                <Label>Invite code quota</Label>
                <Input name="inviteCodeQuota" type="number" min={0} max={1000} defaultValue={editUser?.inviteCodeQuota ?? 0} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InviteQuotaCell({ user, onChanged }: { user: MonitorUser; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const quota = user.inviteCodeQuota ?? 0

  const save = async () => {
    const amount = Number(value)
    setEditing(false)
    if (!Number.isFinite(amount) || amount < 0) return
    await apiRequest(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { inviteCodeQuota: Math.round(amount) } })
    onChanged()
  }

  if (editing) return <Input autoFocus className="ml-auto h-7 w-16 text-right text-xs" type="number" min="0" max="1000" step="1" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(false) }} />

  return <button type="button" title="Edit invite quota" className="rounded-md px-1.5 py-0.5 hover:bg-accent" onClick={() => { setValue(String(quota)); setEditing(true) }}>
    {quota}
  </button>
}

function BillingPlanCell({ row }: { row: AdminBillingUser | undefined }) {
  if (!row) return <span className="text-muted-foreground">—</span>
  const label = row.plan === 'fat' ? 'Fat' : row.plan === 'eight' ? 'Eight' : 'Baby'
  return <span className="flex items-center gap-1.5"><Badge variant={row.plan === 'baby' ? 'outline' : 'secondary'}>{label}</Badge>{row.hold && <AlertTriangle className="size-3.5 text-destructive" />}</span>
}

function WeeklyLimitCell({ row, onChanged }: { row: AdminBillingUser | undefined; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  if (!row) return <span className="text-muted-foreground">—</span>

  const save = async () => {
    const amount = Number(value)
    setEditing(false)
    if (!Number.isFinite(amount) || amount < 0) return
    await apiRequest(`/api/admin/billing/users/${row.userId}/weekly-limit`, {
      method: 'PATCH', body: { weeklyLimitMicros: Math.round(amount * 1_000_000) },
    })
    onChanged()
  }

  if (editing) return <Input autoFocus className="ml-auto h-7 w-20 text-right text-xs" type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(false) }} />

  return <span className="inline-flex items-center justify-end gap-1">
    <button type="button" title="Edit weekly limit" className="rounded-md px-1.5 py-0.5 hover:bg-accent" onClick={() => { setValue((row.weeklyLimitMicros / 1_000_000).toFixed(2)); setEditing(true) }}>
      {formatBalance(row.weeklySpentMicros / 1_000_000)} / {formatBalance(row.weeklyLimitMicros / 1_000_000)}
    </button>
    {row.weeklyLimitOverridden && <Button size="icon-sm" variant="ghost" title="Reset to plan default" onClick={() => {
      void apiRequest(`/api/admin/billing/users/${row.userId}/weekly-limit`, { method: 'PATCH', body: { weeklyLimitMicros: null } }).then(onChanged)
    }}><RefreshCw className="size-3.5" /></Button>}
  </span>
}

function BalanceCell({ user }: { user: MonitorUser }) {
  const updateBalance = useUsage((s) => s.updateBalance)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const save = () => {
    const n = parseFloat(value)
    if (!Number.isNaN(n) && n >= 0) updateBalance(user.id, n)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        title="Edit balance"
        onClick={() => {
          setValue(user.balance.toFixed(2))
          setEditing(true)
        }}
        className="-mr-1.5 cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent"
      >
        {formatBalance(user.balance)}
      </button>
    )
  }

  return (
    <Input
      type="number"
      step="0.01"
      min="0"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="ml-auto h-7 w-24 px-1.5 text-right tabular-nums"
    />
  )
}

function StorageCell({ user, row, onChanged }: { user: MonitorUser; row: AdminBillingUser | undefined; onChanged: () => void }) {
  const updateStorageLimit = useUsage((s) => s.updateStorageLimit)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const limitBytes = row?.storageLimitBytes ?? user.storageLimitBytes ?? 0
  const limitMiB = limitBytes / (1024 * 1024)
  const usedMiB = (user.storageBytes ?? 0) / (1024 * 1024)

  const save = async () => {
    const amount = Number(value)
    setEditing(false)
    if (!Number.isFinite(amount) || amount < 0) return
    const storageLimitBytes = Math.round(amount * 1024 * 1024)
    if (!row) return updateStorageLimit(user.id, storageLimitBytes)
    await apiRequest(`/api/admin/billing/users/${user.id}/storage-limit`, { method: 'PATCH', body: { storageLimitBytes } })
    onChanged()
  }

  if (!editing) return (
    <span className="inline-flex items-center justify-end gap-1">
      <button
        type="button"
        title="Edit file storage allowance"
        onClick={() => { setValue(String(Math.round(limitMiB))); setEditing(true) }}
        className="cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent"
      >
        {usedMiB.toLocaleString(undefined, { maximumFractionDigits: 1 })} / {limitMiB.toLocaleString(undefined, { maximumFractionDigits: 0 })} MiB
      </button>
      {row?.storageLimitOverridden && <Button size="icon-sm" variant="ghost" title="Reset to plan default" onClick={() => {
        void apiRequest(`/api/admin/billing/users/${user.id}/storage-limit`, { method: 'PATCH', body: { storageLimitBytes: null } }).then(onChanged)
      }}><RefreshCw className="size-3.5" /></Button>}
    </span>
  )

  return (
    <Input
      type="number"
      step="100"
      min="0"
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void save()
        if (event.key === 'Escape') setEditing(false)
      }}
      className="ml-auto h-7 w-28 px-1.5 text-right tabular-nums"
    />
  )
}
