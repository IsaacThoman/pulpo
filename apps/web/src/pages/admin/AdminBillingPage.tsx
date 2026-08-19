import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, DollarSign, RefreshCw, Repeat2, UsersRound, WalletCards } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/lib/api'
import { formatBalance, formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Range = '7d' | '30d' | '90d' | 'all'

interface Dashboard {
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
    billingReason: string
    status: string
    totalAmountCents: number
    refundedAmountCents: number
    createdAt: string
  }>
  recentSubscriptions: Array<{
    userName: string
    userEmail: string
    subscription: { polarSubscriptionId: string; plan: 'eight' | 'fat'; status: string; cancelAtPeriodEnd: boolean; updatedAt: string }
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

  const data = dashboardQuery.data
  const totals = data?.totals
  const chart = data?.trend.map((row) => ({ day: row.day.slice(5, 10), collected: row.totalCents / 100 })) ?? []
  const limitsAreValid = [eightLimit, fatLimit].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <div><h2 className="text-lg font-semibold">Billing</h2><p className="text-xs text-muted-foreground">Payments, subscriptions, weekly allowances, and reconciliation health.</p></div>
      <div className="flex-1" />
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

    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardContent className="p-0"><div className="border-b px-4 py-3 text-sm font-medium">Recent payments</div><div className="divide-y">{data?.recentOrders.length ? data.recentOrders.map((order) => <div key={order.polarOrderId} className="flex items-center gap-3 px-4 py-3 text-xs"><div className="min-w-0 flex-1"><div className="font-medium">{order.billingReason.replaceAll('_', ' ')}</div><div className="mt-0.5 text-muted-foreground">{formatDate(Date.parse(order.createdAt))}</div></div><span className="tabular-nums">{formatBalance(order.totalAmountCents / 100)}</span><Badge variant={order.refundedAmountCents > 0 ? 'destructive' : 'outline'}>{order.refundedAmountCents > 0 ? 'refunded' : order.status}</Badge></div>) : <Empty />}</div></CardContent></Card>
      <Card><CardContent className="p-0"><div className="border-b px-4 py-3 text-sm font-medium">Recent subscriptions</div><div className="divide-y">{data?.recentSubscriptions.length ? data.recentSubscriptions.map((row) => <div key={row.subscription.polarSubscriptionId} className="flex items-center gap-3 px-4 py-3 text-xs"><div className="min-w-0 flex-1"><div className="truncate font-medium">{row.userName}</div><div className="truncate text-muted-foreground">{row.userEmail}</div></div><Badge variant={row.subscription.plan === 'fat' ? 'secondary' : 'outline'}>{row.subscription.plan === 'fat' ? 'Fat' : 'Eight'}</Badge><Badge variant={row.subscription.status === 'past_due' ? 'destructive' : 'outline'}>{row.subscription.cancelAtPeriodEnd ? 'canceling' : row.subscription.status}</Badge></div>) : <Empty />}</div></CardContent></Card>
    </div>

    <div className="text-xs text-muted-foreground">Last reconciled: {data?.reconciliation.lastReconciledAt ? new Date(data.reconciliation.lastReconciledAt).toLocaleString() : 'Never'}</div>
  </div>
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) { return <Card><CardContent className="p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="[&>svg]:size-3.5">{icon}</span>{label}</div><div className="mt-2 text-xl font-semibold tabular-nums">{value}</div></CardContent></Card> }
function Stat({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{value}</span></div> }
function MoneyStat({ label, cents }: { label: string; cents: number }) { return <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{formatBalance(cents / 100)}</span></div> }
function LimitInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-1.5"><Label>{label}</Label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input className="w-36 pl-7 tabular-nums" type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} /></div></div> }
function Empty() { return <div className="px-4 py-10 text-center text-xs text-muted-foreground">No data yet.</div> }
