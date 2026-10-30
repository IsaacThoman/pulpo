import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, MessageSquareText, RefreshCw, RotateCcw } from 'lucide-react'
import type { AdminMessageReport, AdminMessageReportStatus } from '@pulpo/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/stores/auth'

/** Messages users reported, each sharing its chat with administrators. */
export function AdminReportsPage() {
  const enabled = useAuth((state) => state.messageReportsEnabled)
  const [status, setStatus] = useState<AdminMessageReportStatus>('open')
  const [reports, setReports] = useState<AdminMessageReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  // Only the latest request may fill the list, so a slow load for the other tab can't land in this one.
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const request = ++latestLoad.current
    setError(null)
    try {
      const result = await apiRequest<{ data: AdminMessageReport[] }>(`/api/admin/message-reports?status=${status}`)
      if (request === latestLoad.current) setReports(result.data)
    } catch (cause) {
      if (request === latestLoad.current) setError(cause instanceof Error ? cause.message : ui('Unable to load reports.'))
    }
  }, [status])
  useEffect(() => { setReports(null); void load() }, [load])

  const setResolved = async (report: AdminMessageReport, resolved: boolean) => {
    setPendingIds((current) => new Set(current).add(report.id))
    try {
      await apiRequest(`/api/admin/message-reports/${report.id}`, { method: 'PATCH', body: { resolved } })
      setReports((current) => current?.filter((item) => item.id !== report.id) ?? null)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui('Unable to update this report.'))
    } finally {
      setPendingIds((current) => { const next = new Set(current); next.delete(report.id); return next })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">{ui('Message reports')}</h2>
          <p className="text-xs text-muted-foreground">{ui('Messages users reported. Each report shares its chat with admins.')}</p>
        </div>
        <div className="flex-1" />
        <Tabs value={status} onValueChange={(value) => setStatus(value as AdminMessageReportStatus)}>
          <TabsList>
            <TabsTrigger value="open">{ui('Unresolved')}</TabsTrigger>
            <TabsTrigger value="resolved">{ui('Resolved')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="icon-sm" onClick={() => void load()} aria-label={ui('Refresh reports')}><RefreshCw /></Button>
      </div>
      {!enabled && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {ui('Message reports are turned off, so users cannot send new reports. Turn them on in Settings.')}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {reports === null ? (
        <div className="grid place-items-center p-8 text-sm text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : reports.length === 0 ? (
        <Card className="items-center p-8 text-sm text-muted-foreground shadow-none">
          {status === 'open' ? ui('No unresolved reports.') : ui('No resolved reports.')}
        </Card>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id}>
              <Card className="gap-3 rounded-lg p-4 shadow-none">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{report.chatTitle || ui('Untitled chat')}</span>
                      <Badge variant="outline">{report.messageRole === 'user' ? ui('User message') : ui('Response')}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {report.reporter.name || report.reporter.username} · {report.reporter.email} · {timeAgo(Date.parse(report.createdAt))}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/chats/${report.chatId}`}><MessageSquareText />{ui('Open chat')}</Link>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pendingIds.has(report.id)} onClick={() => void setResolved(report, !report.resolvedAt)}>
                      {pendingIds.has(report.id) ? <Loader2 className="animate-spin" /> : report.resolvedAt ? <RotateCcw /> : <Check />}
                      {report.resolvedAt ? ui('Reopen') : ui('Resolve')}
                    </Button>
                  </div>
                </div>
                {report.excerpt && (
                  <blockquote className="line-clamp-3 border-l-2 pl-3 text-sm text-muted-foreground [overflow-wrap:anywhere]" title={report.excerpt}>
                    {report.excerpt}
                  </blockquote>
                )}
                {report.context
                  ? <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm">{report.context}</p>
                  : <p className="text-sm text-muted-foreground">{ui('No context provided.')}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
