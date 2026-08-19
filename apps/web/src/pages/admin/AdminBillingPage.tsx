import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, DollarSign, ExternalLink, RefreshCw, Repeat2, UsersRound, WalletCards } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/lib/api'
import { formatBalance, formatDate } from '@/lib/format'
import { polarDashboardUrl, polarOrderUrl, polarSubscriptionUrl, polarWebhooksUrl, type PolarEnvironment } from '@/lib/polar-dashboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Range = '7d' | '30d' | '90d' | 'all'
type ProductKind = 'eight' | 'fat' | 'credits' | 'unknown'

interface Dashboard {
  polar: { environment: PolarEnvironment }
  totals: {
    grossCollectedCents: number
    salesBeforeTaxCents: number
    taxCollectedCents: number
    platformFeesCents: number
    refundedCents: number
    creditsGrantedMicros: number
    payments: number
    topUps: number
    activeSubscribers: number
    monthlyRecurringCents: number
    canceling: number
    pastDue: number
    holds: number
    failedWebhooks: number
  }
  subscribers: { eight: number; fat: number }
  trend: Array<{ day: string; totalCents: number; payments: number }>
  recentOrders: Array<{
    polarOrderId: string
    userName: string
    userEmail: string
    product: ProductKind
    billingReason: string
    status: string
    totalAmountCents: number
    taxAmountCents: number
    refundedAmountCents: number
    grantedCreditMicros: number
    createdAt: string
  }>
  recentSubscriptions: Array<{
    userId: string
    userName: string
    userEmail: string
    polarSubscriptionId: string
    plan: 'eight' | 'fat'
    status: string
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
    paidThrough: string | null
  }>
  failedEvents: Array<{
    providerEventId: string
    type: string
    resourceId: string | null
    error: string | null
    receivedAt: string
  }>
  holds: Array<{
    userId: string
    userName: string
    userEmail: string
    holdAt: string | null
    holdReason: string | null
    holdReference: string | null
  }>
  reconciliation: { lastReconciledAt: string | null; lastError: string | null }
}

interface BillingSettings {
  eightWeeklyLimitMicros: number
  fatWeeklyLimitMicros: number
  lastReconciledAt: string | null
  lastReconcileError: string | null
}

export function AdminBillingPage() {
  const [range, setRange] = useState<Range>('30d')
  const [eightLimit, setEightLimit] = useState('3.00')
  const [fatLimit, setFatLimit] = useState('4.00')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const dashboardQuery = useQuery({
    queryKey: ['admin-billing', range],
    queryFn: () => apiRequest<Dashboard>(`/api/admin/billing/dashboard?range=${range}`),
    refetchInterval: 30_000,
  })
  const settingsQuery = useQuery({
    queryKey: ['admin-billing-settings'],
    queryFn: () => apiRequest<BillingSettings>('/api/admin/billing/settings'),
  })
  useEffect(() => {
    if (!settingsQuery.data) return
    setEightLimit((settingsQuery.data.eightWeeklyLimitMicros / 1_000_000).toFixed(2))
    setFatLimit((settingsQuery.data.fatWeeklyLimitMicros / 1_000_000).toFixed(2))
  }, [settingsQuery.data])

  const saveDefaults = async () => {
    setSaving(true)
    setMessage('')
    try {
      await apiRequest('/api/admin/billing/settings', {
        method: 'PATCH',
        body: {
          eightWeeklyLimitMicros: Math.round(Number(eightLimit) * 1_000_000),
          fatWeeklyLimitMicros: Math.round(Number(fatLimit) * 1_000_000),
        },
      })
      setMessage('Weekly defaults saved.')
      await Promise.all([settingsQuery.refetch(), dashboardQuery.refetch()])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save defaults.')
    } finally {
      setSaving(false)
    }
  }

  const reconcile = async () => {
    setSyncing(true)
    setMessage('')
    try {
      await apiRequest('/api/admin/billing/reconcile', { method: 'POST' })
      setMessage('Reconciliation queued.')
      window.setTimeout(() => { void dashboardQuery.refetch() }, 2_000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not queue reconciliation.')
    } finally {
      setSyncing(false)
    }
  }

  const clearHold = async (userId: string) => {
    const note = prompt('Reconciliation note required to clear this billing hold:')
    if (!note?.trim()) return
    setMessage('')
    try {
      await apiRequest(`/api/admin/billing/users/${userId}/clear-hold`, { method: 'POST', body: { note } })
      setMessage('Billing hold cleared.')
      await dashboardQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not clear hold.')
    }
  }

  const data = dashboardQuery.data
  const totals = data?.totals
  const polarEnv = data?.polar.environment
  const chart = data?.trend.map((row) => ({ day: row.day.slice(5, 10), collected: row.totalCents / 100 })) ?? []
  const limitsAreValid = [eightLimit, fatLimit].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <div><h2 className="text-lg font-semibold">Billing</h2><p className="text-xs text-muted-foreground">Payments, subscriptions, weekly allowances, and reconciliation health.</p></div>
      <div className="flex-1" />
      {polarEnv && <>
        <Button variant="outline" size="sm" asChild><a href={polarDashboardUrl(polarEnv)} target="_blank" rel="noreferrer"><ExternalLink />Polar</a></Button>
        <Button variant="outline" size="sm" asChild><a href={polarWebhooksUrl(polarEnv)} target="_blank" rel="noreferrer"><ExternalLink />Webhooks</a></Button>
      </>}
      <Select value={range} onValueChange={(value: Range) => setRange(value)}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent>{(['7d', '30d', '90d', 'all'] as const).map((value) => <SelectItem key={value} value={value}>{value === 'all' ? 'All time' : value}</SelectItem>)}</SelectContent></Select>
      <Button variant="outline" size="sm" onClick={() => void reconcile()} disabled={syncing}><RefreshCw className={syncing ? 'animate-spin' : ''} />Sync now</Button>
    </div>

    {message && <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">{message}</div>}
    {data?.reconciliation.lastError && <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5" />Last reconciliation failed: {data.reconciliation.lastError}</div>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Metric icon={<DollarSign />} label="Collected" value={formatBalance((totals?.grossCollectedCents ?? 0) / 100)} />
      <Metric icon={<Repeat2 />} label="MRR" value={formatBalance((totals?.monthlyRecurringCents ?? 0) / 100)} />
      <Metric icon={<UsersRound />} label="Subscribers" value={totals?.activeSubscribers ?? 0} />
      <Metric icon={<WalletCards />} label="Credits granted" value={formatBalance((totals?.creditsGrantedMicros ?? 0) / 1_000_000)} />
      <Metric icon={<CreditCard />} label="Payments" value={totals?.payments ?? 0} />
      <Metric icon={<AlertTriangle />} label="Needs attention" value={(totals?.holds ?? 0) + (totals?.pastDue ?? 0) + (totals?.failedWebhooks ?? 0)} />
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardContent className="h-64 p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-medium">Payment volume</span><span className="text-xs text-muted-foreground">Includes tax</span></div><ResponsiveContainer width="100%" height="88%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${value}`} /><Tooltip formatter={(value) => formatBalance(Number(value))} /><Bar dataKey="collected" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
      <Card><CardContent className="space-y-4 p-4"><div className="text-sm font-medium">Subscription health</div><Stat label="Pulpo Eight" value={data?.subscribers.eight ?? 0} /><Stat label="Le Pulpo Fat" value={data?.subscribers.fat ?? 0} /><Stat label="Canceling" value={totals?.canceling ?? 0} /><Stat label="Past due" value={totals?.pastDue ?? 0} /><Stat label="Billing holds" value={totals?.holds ?? 0} /><Stat label="Failed webhooks" value={totals?.failedWebhooks ?? 0} /></CardContent></Card>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardContent className="space-y-3 p-4"><div className="mb-1 text-sm font-medium">Payment breakdown</div><MoneyStat label="Sales before tax" cents={totals?.salesBeforeTaxCents ?? 0} /><MoneyStat label="Tax collected" cents={totals?.taxCollectedCents ?? 0} /><MoneyStat label="Processing fees" cents={totals?.platformFeesCents ?? 0} /><MoneyStat label="Refunded" cents={totals?.refundedCents ?? 0} /><Stat label="Top-ups" value={totals?.topUps ?? 0} /></CardContent></Card>
      <Card><CardContent className="p-4"><div className="mb-4"><div className="text-sm font-medium">Default weekly limits</div><p className="mt-0.5 text-xs text-muted-foreground">USD values are internal. Users only see the percentage remaining.</p></div><div className="flex flex-wrap items-end gap-4"><LimitInput label="Pulpo Eight" value={eightLimit} onChange={setEightLimit} /><LimitInput label="Le Pulpo Fat" value={fatLimit} onChange={setFatLimit} /><Button onClick={() => void saveDefaults()} disabled={saving || !limitsAreValid}>{saving ? 'Saving…' : 'Save defaults'}</Button></div></CardContent></Card>
    </div>

    <Card>
      <CardContent className="overflow-x-auto p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">Recent payments</div>
        {data?.recentOrders.length ? <table className="w-full min-w-max text-xs">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="px-4 py-2 font-medium">User</th><th className="px-4 py-2 font-medium">Reason</th><th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 text-right font-medium">Credits</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 text-right font-medium" /></tr></thead>
          <tbody>{data.recentOrders.map((order) => <tr key={order.polarOrderId} className="border-b last:border-0">
            <td className="max-w-48 px-4 py-2.5"><div className="truncate font-medium">{order.userName}</div><div className="truncate text-muted-foreground">{order.userEmail}</div></td>
            <td className="px-4 py-2.5">{humanReason(order.billingReason)}</td>
            <td className="px-4 py-2.5"><ProductBadge product={order.product} /></td>
            <td className="px-4 py-2.5 text-right tabular-nums">{formatBalance(order.totalAmountCents / 100)}{order.taxAmountCents > 0 && <div className="text-muted-foreground">{formatBalance(order.taxAmountCents / 100)} tax</div>}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{order.grantedCreditMicros > 0 ? formatBalance(order.grantedCreditMicros / 1_000_000) : '—'}</td>
            <td className="px-4 py-2.5"><Badge variant={order.refundedAmountCents > 0 ? 'destructive' : 'outline'}>{order.refundedAmountCents > 0 ? 'refunded' : order.status}</Badge></td>
            <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDate(Date.parse(order.createdAt))}</td>
            <td className="px-4 py-2.5 text-right">{polarEnv && <PolarLink href={polarOrderUrl(polarEnv, order.polarOrderId)} />}</td>
          </tr>)}</tbody>
        </table> : <Empty />}
      </CardContent>
    </Card>

    <Card>
      <CardContent className="overflow-x-auto p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">Recent subscriptions</div>
        {data?.recentSubscriptions.length ? <table className="w-full min-w-max text-xs">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="px-4 py-2 font-medium">User</th><th className="px-4 py-2 font-medium">Plan</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Paid through</th><th className="px-4 py-2 font-medium">Period end</th><th className="px-4 py-2 text-right font-medium" /></tr></thead>
          <tbody>{data.recentSubscriptions.map((row) => <tr key={row.polarSubscriptionId} className="border-b last:border-0">
            <td className="max-w-48 px-4 py-2.5"><div className="truncate font-medium">{row.userName}</div><div className="truncate text-muted-foreground">{row.userEmail}</div></td>
            <td className="px-4 py-2.5"><ProductBadge product={row.plan} /></td>
            <td className="px-4 py-2.5"><Badge variant={row.status === 'past_due' ? 'destructive' : 'outline'}>{row.cancelAtPeriodEnd ? 'canceling' : row.status}</Badge></td>
            <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{row.paidThrough ? formatDate(Date.parse(row.paidThrough)) : '—'}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{row.currentPeriodEnd ? formatDate(Date.parse(row.currentPeriodEnd)) : '—'}</td>
            <td className="px-4 py-2.5 text-right">{polarEnv && <PolarLink href={polarSubscriptionUrl(polarEnv, row.polarSubscriptionId)} />}</td>
          </tr>)}</tbody>
        </table> : <Empty />}
      </CardContent>
    </Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <div className="flex items-center justify-between border-b px-4 py-3"><div className="text-sm font-medium">Failed webhooks</div>{polarEnv && <PolarLink href={polarWebhooksUrl(polarEnv)} label="Polar deliveries" />}</div>
          {data?.failedEvents.length ? <div className="divide-y">{data.failedEvents.map((event) => <div key={event.providerEventId} className="space-y-1 px-4 py-3 text-xs">
            <div className="flex items-center gap-2"><span className="font-medium">{event.type}</span><span className="text-muted-foreground">{formatDate(Date.parse(event.receivedAt))}</span></div>
            {event.resourceId && <div className="truncate font-mono text-[11px] text-muted-foreground">{event.resourceId}</div>}
            {event.error && <div className="text-destructive">{event.error}</div>}
          </div>)}</div> : <Empty label="No failed webhooks." />}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <div className="border-b px-4 py-3 text-sm font-medium">Billing holds</div>
          {data?.holds.length ? <div className="divide-y">{data.holds.map((hold) => <div key={hold.userId} className="flex items-start gap-3 px-4 py-3 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{hold.userName}</div>
              <div className="truncate text-muted-foreground">{hold.userEmail}</div>
              <div className="mt-1 text-muted-foreground">{hold.holdReason?.replaceAll('_', ' ') ?? 'hold'}{hold.holdAt ? ` · ${formatDate(Date.parse(hold.holdAt))}` : ''}</div>
              {hold.holdReference && <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{hold.holdReference}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {polarEnv && hold.holdReference && hold.holdReason === 'payment_reversed' && <PolarLink href={polarOrderUrl(polarEnv, hold.holdReference)} />}
              <Button size="sm" variant="outline" onClick={() => void clearHold(hold.userId)}>Clear</Button>
            </div>
          </div>)}</div> : <Empty label="No billing holds." />}
        </CardContent>
      </Card>
    </div>

    <div className="text-xs text-muted-foreground">Last reconciled: {data?.reconciliation.lastReconciledAt ? new Date(data.reconciliation.lastReconciledAt).toLocaleString() : 'Never'}</div>
  </div>
}

function humanReason(reason: string) {
  if (reason === 'purchase') return 'Top-up'
  if (reason === 'subscription_create') return 'Subscription create'
  if (reason === 'subscription_cycle') return 'Renewal'
  if (reason === 'subscription_update') return 'Plan update'
  return reason.replaceAll('_', ' ')
}

function productLabel(product: ProductKind | 'eight' | 'fat') {
  if (product === 'fat') return 'Fat'
  if (product === 'eight') return 'Eight'
  if (product === 'credits') return 'Top-up'
  return 'Other'
}

function ProductBadge({ product }: { product: ProductKind | 'eight' | 'fat' }) {
  return <Badge variant={product === 'fat' ? 'secondary' : 'outline'}>{productLabel(product)}</Badge>
}

function PolarLink({ href, label = 'Polar' }: { href: string; label?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
    {label}<ExternalLink className="size-3" />
  </a>
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) { return <Card><CardContent className="p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="[&>svg]:size-3.5">{icon}</span>{label}</div><div className="mt-2 text-xl font-semibold tabular-nums">{value}</div></CardContent></Card> }
function Stat({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{value}</span></div> }
function MoneyStat({ label, cents }: { label: string; cents: number }) { return <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{formatBalance(cents / 100)}</span></div> }
function LimitInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-1.5"><Label>{label}</Label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input className="w-36 pl-7 tabular-nums" type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} /></div></div> }
function Empty({ label = 'No data yet.' }: { label?: string }) { return <div className="px-4 py-10 text-center text-xs text-muted-foreground">{label}</div> }
