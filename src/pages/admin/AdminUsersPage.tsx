import { useState } from 'react'
import { MessagesSquare, Pencil, Plus, Search, Trash2, Users2 } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { formatDate, timeAgo } from '@/lib/format'
import type { MonitorUser } from '@/lib/types'
import { Button } from '@/components/ui/button'
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
import { Toggle } from '@/components/admin/kit'
import { cn } from '@/lib/utils'

interface Group {
  id: string
  name: string
  color: string
  members: number
  description: string
}

const GROUPS: Group[] = [
  { id: 'g-1', name: 'engineering', color: '#3b82f6', members: 4, description: 'Full model access, higher rate limits.' },
  { id: 'g-2', name: 'design', color: '#ec4899', members: 2, description: 'Image generation models enabled.' },
  { id: 'g-3', name: 'externals', color: '#f59e0b', members: 1, description: 'Sandboxed — cheap models only, no tools.' },
]

const PERMISSIONS: [string, boolean][] = [
  ['Workspace: models', true],
  ['Workspace: knowledge', true],
  ['Workspace: prompts', true],
  ['Workspace: tools', false],
  ['Features: web search', true],
  ['Features: image generation', true],
  ['Features: code interpreter', false],
  ['Features: temporary chats', true],
  ['Sharing: public models', false],
  ['Sharing: public knowledge', false],
]

export function AdminUsersPage() {
  const users = useUsage((s) => s.users)
  const [tab, setTab] = useState<'overview' | 'groups'>('overview')
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<MonitorUser | null>(null)
  const [perms, setPerms] = useState(PERMISSIONS)

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Users</h2>
        <div className="ml-2 flex rounded-lg border p-0.5">
          {(['overview', 'groups'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-xs capitalize transition-colors',
                tab === t ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'overview' ? (
          <>
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
          </>
        ) : (
          <Button size="sm">
            <Plus />
            New group
          </Button>
        )}
      </div>

      {tab === 'overview' && (
        <Card className="shadow-none">
          <CardContent className="px-0 py-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="py-2.5 font-medium">Name</th>
                  <th className="py-2.5 font-medium">Email</th>
                  <th className="py-2.5 font-medium">Last active</th>
                  <th className="py-2.5 font-medium">Created</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-5 py-2.5">
                      <Select defaultValue={u.role}>
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
                    <td className="py-2.5 text-muted-foreground">{timeAgo(Date.now() - 3 * 3_600_000)}</td>
                    <td className="py-2.5 text-muted-foreground">{formatDate(u.joinedAt)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-sm" variant="ghost" title="User chats">
                          <MessagesSquare className="size-3.5" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" title="Edit" onClick={() => setEditUser(u)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Delete"
                          className="hover:text-destructive"
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
      )}

      {tab === 'groups' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {GROUPS.map((g) => (
              <Card key={g.id} className="shadow-none">
                <CardContent className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="font-medium">{g.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Users2 className="size-3" />
                      {g.members}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{g.description}</p>
                  <Button variant="outline" size="sm" className="mt-3 w-full">
                    Manage
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="shadow-none">
            <CardContent className="px-4 py-4">
              <div className="text-sm font-medium">Default permissions</div>
              <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                Applies to all users with the “user” role.
              </p>
              <div className="divide-y">
                {perms.map(([label, val], i) => (
                  <Toggle
                    key={label}
                    label={label}
                    checked={val}
                    onChange={(v) => setPerms((p) => p.map((x, j) => (j === i ? [x[0], v] : x)))}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* add user */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select defaultValue="user">
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
              <Input placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="name@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="Temporary password" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setAddOpen(false)}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit user */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Joined {editUser && formatDate(editUser.joinedAt)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input defaultValue={editUser?.name} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input defaultValue={editUser?.email} />
            </div>
            <div className="space-y-1.5">
              <Label>OAuth ID</Label>
              <Input placeholder="—" />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input type="password" placeholder="Leave blank to keep" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setEditUser(null)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
