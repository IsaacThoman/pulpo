import { useEffect, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { formatCost, formatDate, timeAgo } from '@/lib/format'
import type { MonitorUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
                <th className="py-2.5 font-medium">Name</th>
                <th className="py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                <th className="px-4 py-2.5 font-medium">Last active</th>
                <th className="py-2.5 font-medium">Created</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-5 py-2.5">
                    <Select value={u.role} onValueChange={(role) => void patchUser(u.id, { role })}>
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
                      <Avatar className="size-6">
                        <AvatarFallback className="bg-zinc-700 text-[9px] font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900">
                          {u.name.split(' ').map((w) => w[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      {u.name}
                    </span>
                  </td>
                  <td className="py-2.5 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <BalanceCell user={u} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {u.lastActiveAt ? timeAgo(u.lastActiveAt) : 'Never'}
                  </td>
                  <td className="py-2.5 text-muted-foreground">{formatDate(u.joinedAt)}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-end gap-1">
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
              <Label>Name</Label>
              <Input name="name" placeholder="Full name" required />
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
              <Label>Name</Label>
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
        {formatCost(user.balance)}
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
