import { useEffect, useState } from 'react'
import { Pencil, Plus, Search, ShieldOff, Trash2 } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { formatBalance, formatDate, timeAgo } from '@/lib/format'
import type { MonitorUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
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
  const loadAdmin = useUsage((s) => s.loadAdmin)
  useEffect(() => { void loadAdmin() }, [loadAdmin])

  const patchUser = async (id: string, patch: Record<string, unknown>) => {
    await apiRequest(`/api/admin/users/${id}`, { method: 'PATCH', body: patch })
    await loadAdmin()
  }

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
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
        <CardContent className="px-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Role</th>
                <th className="py-2.5 font-medium">Display name</th>
                <th className="py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                <th className="px-4 py-2.5 text-right font-medium">File storage</th>
                <th className="px-4 py-2.5 font-medium">Last active</th>
                <th className="py-2.5 font-medium">Created</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-5 py-2.5">
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
                  <td className="py-2.5">
                    <span className="flex items-center gap-2">
                      <ProfileAvatar name={u.name} avatarUrl={u.avatarUrl} className="size-6" fallbackClassName="text-[9px]" />
                      {u.name}
                    </span>
                  </td>
                  <td className="py-2.5 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <BalanceCell user={u} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <StorageCell user={u} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {u.lastActiveAt ? timeAgo(u.lastActiveAt) : 'Never'}
                  </td>
                  <td className="py-2.5 text-muted-foreground">{formatDate(u.joinedAt)}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-end gap-1">
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
              role: values.get('role'), name: values.get('name'), email: values.get('email'), password: values.get('password'),
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
              name: values.get('name'), email: values.get('email'), ...(password ? { password } : {}),
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
              <Label>Email</Label>
              <Input name="email" type="email" defaultValue={editUser?.email} required />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input name="password" type="password" minLength={8} placeholder="Leave blank to keep" />
            </div>
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

function StorageCell({ user }: { user: MonitorUser }) {
  const updateStorageLimit = useUsage((s) => s.updateStorageLimit)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const limitMiB = (user.storageLimitBytes ?? 0) / (1024 * 1024)
  const usedMiB = (user.storageBytes ?? 0) / (1024 * 1024)

  const save = () => {
    const amount = Number(value)
    if (Number.isFinite(amount) && amount >= 0) updateStorageLimit(user.id, Math.round(amount * 1024 * 1024))
    setEditing(false)
  }

  if (!editing) return (
    <button
      type="button"
      title="Edit file storage allowance"
      onClick={() => { setValue(String(Math.round(limitMiB))); setEditing(true) }}
      className="-mr-1.5 cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent"
    >
      {usedMiB.toLocaleString(undefined, { maximumFractionDigits: 1 })} / {limitMiB.toLocaleString(undefined, { maximumFractionDigits: 0 })} MiB
    </button>
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
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save()
        if (event.key === 'Escape') setEditing(false)
      }}
      className="ml-auto h-7 w-28 px-1.5 text-right tabular-nums"
    />
  )
}
