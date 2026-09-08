import { ComputerSettings } from './ComputerSettings'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Monitor, RefreshCw, Smartphone } from 'lucide-react'
import type { DeviceSession, DeviceSessionList } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { formatDateTime, timeAgo } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const platforms = { ios: 'iOS', android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux', unknown: 'Unknown platform' }
const apps = { web: 'Web', mobile: 'Mobile app', desktop: 'Desktop app', cli: 'CLI', unknown: 'Unknown app' }

export function DeviceSessionListView({ userId }: { userId?: string }) {
  const currentUserId = useAuth((state) => state.user?.id)
  const [confirmation, setConfirmation] = useState<DeviceSession | 'bulk' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const base = userId ? `/api/admin/users/${userId}/sessions` : '/api/me/sessions'
  const query = useQuery({
    queryKey: ['device-sessions', userId ?? currentUserId, userId ? 'admin' : 'self'],
    queryFn: () => apiRequest<DeviceSessionList>(base),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const sessions = query.data?.sessions ?? []
  const bulkLabel = userId ? ui('Sign out all devices') : ui('Sign out all other devices')
  const endsCurrent = confirmation === 'bulk' ? Boolean(userId && userId === currentUserId) : Boolean(confirmation?.isCurrent)
  const revoke = async () => {
    if (!confirmation) return
    setBusy(true)
    setError('')
    try {
      await apiRequest(confirmation === 'bulk' ? `${base}/${userId ? 'revoke-all' : 'revoke-others'}` : `${base}/${confirmation.id}`, {
        method: confirmation === 'bulk' ? 'POST' : 'DELETE',
      })
      setConfirmation(null)
      if (endsCurrent) await useAuth.getState().logout(true)
      else await query.refetch()
    } catch (next) {
      setError(next instanceof Error ? next.message : ui('Could not sign out device.'))
    } finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{ui('Each entry is a signed-in session. Different browsers on one device can appear separately.')}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={query.isFetching || busy} onClick={() => void query.refetch()}><RefreshCw />{ui('Refresh')}</Button>
      <Button variant="outline" size="sm" disabled={busy || !sessions.some((session) => userId || !session.isCurrent)} onClick={() => { setError(''); setConfirmation('bulk') }}>{bulkLabel}</Button>
    </div>
    {query.isPending && <p role="status">{ui('Loading devices…')}</p>}
    {query.error && <div role="alert" className="text-sm text-destructive">{query.error.message} <Button variant="link" onClick={() => void query.refetch()}>{ui('Retry')}</Button></div>}
    {!query.isPending && !query.error && !sessions.length && <p className="text-sm text-muted-foreground">{ui('No signed-in devices.')}</p>}
    <div className="space-y-3">
      {sessions.map((session) => {
        const Icon = session.appType === 'mobile' ? Smartphone : Monitor
        return <div key={session.id} className="rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="break-words text-sm font-medium">{session.deviceLabel} {session.isCurrent && <span className="ml-1 rounded bg-accent px-1.5 py-0.5 text-xs">{ui('This device')}</span>}</div>
              <div className="text-xs text-muted-foreground">{[ui(apps[session.appType]), ui(platforms[session.platform]), session.browser].filter(Boolean).join(' · ')}</div>
              <div className="break-all text-xs text-muted-foreground">{ui('Latest IP')}: {session.latestIp ?? ui('Not yet observed')}</div>
              <div className="text-xs text-muted-foreground" title={formatDateTime(Date.parse(session.lastSeenAt))}>{ui('Last active')}: {timeAgo(Date.parse(session.lastSeenAt))}</div>
            </div>
            <Button size="sm" variant="outline" disabled={busy} aria-label={ui('Sign out {{device}}', { device: session.deviceLabel })} onClick={() => { setError(''); setConfirmation(session) }}>{ui('Sign out')}</Button>
          </div>
          <details className="ml-8 mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{ui('Details')}</summary>
            <div className="mt-2 break-all">{ui('Sign-in IP')}: {session.signInIp ?? ui('Unknown')}</div>
            <div>{ui('Signed in')}: {formatDateTime(Date.parse(session.createdAt))}</div>
          </details>
        </div>
      })}
    </div>
    <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !busy) { setConfirmation(null); setError('') } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{confirmation === 'bulk' ? bulkLabel : ui('Sign out device?')}</DialogTitle><DialogDescription>
          {confirmation === 'bulk' ? ui('These sessions will need to sign in again.') : ui('Sign out {{device}}? It will need to sign in again.', { device: confirmation?.deviceLabel ?? '' })}
          {endsCurrent && <> {ui('This includes your current device. You will return to sign-in.')}</>}
        </DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>{ui('Cancel')}</Button><Button variant="destructive" disabled={busy} onClick={() => void revoke()}>{busy ? ui('Signing out…') : ui('Sign out')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

export function DeviceSettings() {
  return <div>
    <h2 className="text-base font-semibold">{ui('Devices')}</h2>
    <Separator className="my-3" />
    <ComputerSettings />
    <DeviceSessionListView />
  </div>
}
