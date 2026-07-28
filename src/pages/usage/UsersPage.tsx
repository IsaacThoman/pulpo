import { useMemo, useState } from 'react'
import { Ban, Check, Copy, Link2, Pencil, Search } from 'lucide-react'
import { useUsage } from '@/stores/usage'
import { formatCost, formatNumber, timeAgo } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { MonitorUser } from '@/lib/types'

export function UsersPage() {
  const users = useUsage((s) => s.users)
  const records = useUsage((s) => s.records)
  const updateBalance = useUsage((s) => s.updateBalance)
  const toggleBlocked = useUsage((s) => s.toggleBlocked)
  const [query, setQuery] = useState('')
  const [editUser, setEditUser] = useState<MonitorUser | null>(null)
  const [balance, setBalance] = useState('')
  const [blockUser, setBlockUser] = useState<MonitorUser | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const stats = useMemo(() => {
    const m = new Map<string, { calls: number; cost: number; last: number }>()
    for (const r of records) {
      const e = m.get(r.userId) ?? { calls: 0, cost: 0, last: 0 }
      e.calls++
      e.cost += r.cost
      e.last = Math.max(e.last, r.timestamp)
      m.set(r.userId, e)
    }
    return m
  }, [records])

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Users</h2>
        <Badge variant="secondary">{users.length}</Badge>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="Search users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <Card className="shadow-none">
        <CardContent className="px-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="py-2.5 font-medium">Role</th>
                <th className="py-2.5 text-right font-medium">Calls</th>
                <th className="py-2.5 text-right font-medium">Spend</th>
                <th className="py-2.5 text-right font-medium">Balance</th>
                <th className="py-2.5 font-medium">Last active</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const s = stats.get(u.id) ?? { calls: 0, cost: 0, last: 0 }
                return (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="py-2.5">
                      <Badge variant={u.role === 'admin' ? 'default' : 'outline'}>{u.role}</Badge>
                      {u.blocked && (
                        <Badge variant="destructive" className="ml-1.5">
                          blocked
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{formatNumber(s.calls)}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatCost(s.cost)}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      <span className={u.balance < 1 ? 'text-destructive' : undefined}>
                        {formatCost(u.balance)}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{s.last ? timeAgo(s.last) : '—'}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Edit balance"
                          onClick={() => {
                            setEditUser(u)
                            setBalance(u.balance.toFixed(2))
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Copy viewer login link"
                          onClick={() => {
                            navigator.clipboard
                              ?.writeText(`https://kimi.dev/u/token-${u.id}`)
                              .catch(() => {})
                            setCopied(u.id)
                            setTimeout(() => setCopied(null), 1200)
                          }}
                        >
                          {copied === u.id ? (
                            <Check className="size-3.5 text-emerald-500" />
                          ) : (
                            <Link2 className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title={u.blocked ? 'Unblock' : 'Block'}
                          onClick={() => setBlockUser(u)}
                        >
                          <Ban className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* edit balance */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit balance</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (editUser) updateBalance(editUser.id, parseFloat(balance) || 0)
                setEditUser(null)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* confirm block */}
      <Dialog open={!!blockUser} onOpenChange={(v) => !v && setBlockUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{blockUser?.blocked ? 'Unblock' : 'Block'} {blockUser?.name}?</DialogTitle>
            <DialogDescription>
              {blockUser?.blocked
                ? 'They will regain access to chat immediately.'
                : 'Blocked users cannot send messages or use API keys. Their history is kept.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockUser(null)}>
              Cancel
            </Button>
            <Button
              variant={blockUser?.blocked ? 'default' : 'destructive'}
              onClick={() => {
                if (blockUser) toggleBlocked(blockUser.id)
                setBlockUser(null)
              }}
            >
              {blockUser?.blocked ? 'Unblock' : 'Block'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function copyText(t: string) {
  navigator.clipboard?.writeText(t).catch(() => {})
}

export function CopyIcon() {
  return <Copy className="size-3.5" />
}
