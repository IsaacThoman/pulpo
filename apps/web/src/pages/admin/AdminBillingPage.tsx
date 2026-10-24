import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, ExternalLink, Gauge, Minus, Pencil, Plus, RefreshCw, Repeat2, SlidersHorizontal, Trash2, UsersRound, WalletCards } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, matchByDataKey } from 'recharts'
import { apiRequest } from '@/lib/api'
import { formatBalance, formatDate } from '@/lib/format'
import { billingPlanName, type BillingPlan, type CustomLimitPeriod, type UsageTier } from '@/lib/billing'
import { stripeDashboardUrl, stripePaymentUrl, stripeSubscriptionUrl, stripeWebhooksUrl, type StripeMode } from '@/lib/stripe-dashboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { ui, uit, activeLocale } from '@/i18n/ui'
import { useSettings } from '@/stores/settings'
import { DEFAULT_CHART_ANIMATION_DURATION_MS, scaledAnimationDuration } from '@/lib/animation-speed'
import { UserListEditor } from './ModelAccessEditor'
import { useAdminUserDirectory, type UserDirectory } from './user-directory'

type Range = '7d' | '30d' | '90d' | 'all'
/** animate bars by full date so a range change keeps each day in place */
const MATCH_BY_DATE = matchByDataKey('date')
type ProductKind = 'eight' | 'fat' | 'credits' | 'unknown'
type BillingProvider = 'stripe' | 'app_store'

const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: "7d" },
  { id: '30d', label: "30d" },
  { id: '90d', label: "90d" },
  { id: 'all', label: "All" },
]

interface Dashboard {
  stripe: { mode: StripeMode }
  totals: {
    grossCollectedCents: number
    salesBeforeTaxCents: number
    taxCollectedCents: number
    platformFeesCents: number
    processingFeesCents: number
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
    paymentId: string
    provider: BillingProvider
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
    subscriptionId: string
    provider: BillingProvider
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
  eightFiveHourLimitMicros: number
  fatFiveHourLimitMicros: number
  fatSharedWeeklyPercent: number
  sharedFiveHourLimitMicros: number
  babyStorageLimitBytes: number
  eightStorageLimitBytes: number
  fatStorageLimitBytes: number
  usageTiers: UsageTier[]
  lastReconciledAt: string | null
  lastReconcileError: string | null
}

export function AdminBillingPage() {
  const [range, setRange] = useState<Range>('30d')
  const animationSpeed = useSettings((state) => state.animationSpeed)
  const animationDuration = scaledAnimationDuration(DEFAULT_CHART_ANIMATION_DURATION_MS, animationSpeed)
  const [eightLimit, setEightLimit] = useState('3.00')
  const [fatLimit, setFatLimit] = useState('4.00')
  const [eightFiveHourLimit, setEightFiveHourLimit] = useState('1.00')
  const [fatFiveHourLimit, setFatFiveHourLimit] = useState('1.00')
  const [sharedPercent, setSharedPercent] = useState('50')
  const [sharedFiveHourLimit, setSharedFiveHourLimit] = useState('1.00')
  const [babyStorage, setBabyStorage] = useState('5')
  const [eightStorage, setEightStorage] = useState('25')
  const [fatStorage, setFatStorage] = useState('100')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const dashboardQuery = useQuery({
    queryKey: ['admin-billing-v2', range],
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
    setEightFiveHourLimit((settingsQuery.data.eightFiveHourLimitMicros / 1_000_000).toFixed(2))
    setFatFiveHourLimit((settingsQuery.data.fatFiveHourLimitMicros / 1_000_000).toFixed(2))
    setSharedPercent(String(settingsQuery.data.fatSharedWeeklyPercent))
    setSharedFiveHourLimit((settingsQuery.data.sharedFiveHourLimitMicros / 1_000_000).toFixed(2))
    setBabyStorage(String(settingsQuery.data.babyStorageLimitBytes / (1024 ** 3)))
    setEightStorage(String(settingsQuery.data.eightStorageLimitBytes / (1024 ** 3)))
    setFatStorage(String(settingsQuery.data.fatStorageLimitBytes / (1024 ** 3)))
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
          eightFiveHourLimitMicros: Math.round(Number(eightFiveHourLimit) * 1_000_000),
          fatFiveHourLimitMicros: Math.round(Number(fatFiveHourLimit) * 1_000_000),
          fatSharedWeeklyPercent: Math.round(Number(sharedPercent)),
          sharedFiveHourLimitMicros: Math.round(Number(sharedFiveHourLimit) * 1_000_000),
          babyStorageLimitBytes: Math.round(Number(babyStorage) * 1024 ** 3),
          eightStorageLimitBytes: Math.round(Number(eightStorage) * 1024 ** 3),
          fatStorageLimitBytes: Math.round(Number(fatStorage) * 1024 ** 3),
        },
      })
      setMessage(ui("Plan defaults saved."))
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
      setMessage(ui("Reconciliation queued."))
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
      setMessage(ui("Billing hold cleared."))
      await dashboardQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not clear hold.')
    }
  }

  const data = dashboardQuery.data
  const totals = data?.totals
  const stripeMode = data?.stripe?.mode
  const chart = data?.trend.map((row) => ({ date: row.day.slice(0, 10), day: row.day.slice(5, 10), collected: row.totalCents / 100 })) ?? []
  const limitsAreValid = [eightLimit, fatLimit, eightFiveHourLimit, fatFiveHourLimit, sharedFiveHourLimit, babyStorage, eightStorage, fatStorage]
    .every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
    && Number.isInteger(Number(sharedPercent)) && Number(sharedPercent) >= 0 && Number(sharedPercent) <= 100
  const attention = (totals?.holds ?? 0) + (totals?.pastDue ?? 0) + (totals?.failedWebhooks ?? 0)
  const stats = [
    { label: ui("Collected"), value: formatBalance((totals?.grossCollectedCents ?? 0) / 100) },
    { label: ui("MRR"), value: formatBalance((totals?.monthlyRecurringCents ?? 0) / 100) },
    { label: ui("Subscribers"), value: (totals?.activeSubscribers ?? 0).toLocaleString(activeLocale()) },
    { label: ui("Credits granted"), value: formatBalance((totals?.creditsGrantedMicros ?? 0) / 1_000_000) },
    { label: ui("Payments"), value: (totals?.payments ?? 0).toLocaleString(activeLocale()) },
    { label: ui("Needs attention"), value: attention.toLocaleString(activeLocale()), alert: attention > 0 },
  ]
  const breakdown = [
    { label: ui("Sales before tax"), value: formatBalance((totals?.salesBeforeTaxCents ?? 0) / 100) },
    { label: ui("Tax collected"), value: formatBalance((totals?.taxCollectedCents ?? 0) / 100) },
    { label: ui("Platform fees"), value: formatBalance((totals?.platformFeesCents ?? 0) / 100) },
    { label: ui("Stripe fees"), value: formatBalance((totals?.processingFeesCents ?? 0) / 100) },
    { label: ui("Refunded"), value: formatBalance((totals?.refundedCents ?? 0) / 100) },
    { label: ui("Top-ups"), value: (totals?.topUps ?? 0).toLocaleString(activeLocale()) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium">{ui("Billing overview")}</span>
          {stripeMode && <>
            <div className="h-4 w-px bg-border" />
            <StripeLink href={stripeDashboardUrl(stripeMode)} />
            <StripeLink href={stripeWebhooksUrl(stripeMode)} label={ui("Webhooks")} />
          </>}
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup options={RANGES.map((option) => ({ ...option, label: ui(option.label) }))} value={range} onChange={setRange} />
          <Button variant="outline" size="sm" onClick={() => void reconcile()} disabled={syncing}>
            <RefreshCw className={syncing ? 'animate-spin' : ''} />{ui("Sync now")} </Button>
        </div>
      </div>

      {message && <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">{message}</div>}
      {data?.reconciliation.lastError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5" />{ui("Last reconciliation failed:")} {data.reconciliation.lastError}
        </div>
      )}

      <div className="stat-grid stat-strip lg:gap-0 lg:[--stat-divider-width:1px]">
        {stats.map((stat) => (
          <div key={stat.label} className="p-3 lg:first:pl-0 lg:last:pr-0">
            <div className="mb-1 text-xs text-muted-foreground">{stat.label}</div>
            <div className={`text-lg font-medium tabular-nums ${stat.alert ? 'text-destructive' : ''}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{ui("Payment volume")}</h3>
          <span className="text-xs text-muted-foreground">{ui("Includes tax")}</span>
        </div>
        {chart.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-xs text-muted-foreground">{ui("No payments in this period")}</div>
        ) : (
          <div className="mt-3 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={30} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={48} tickFormatter={(value: number) => axisCost(value)} />
                <Tooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }} content={<ChartTip />} />
                <Bar dataKey="collected" fill="hsl(160 60% 45%)" maxBarSize={28} animationDuration={animationDuration} animationMatchBy={MATCH_BY_DATE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="stat-grid stat-strip gap-2 sm:gap-0 sm:[--stat-divider-width:1px]">
          {breakdown.map((row) => (
            <div key={row.label} className="py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
              <div className="text-xs text-muted-foreground">{row.label}</div>
              <div className="mt-1 text-sm font-medium tabular-nums">{row.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={<UsersRound className="size-3" />} title={ui("Subscription health")}>
          <div className="divide-y">
            <Stat label={ui("Pulpo Eight")} value={data?.subscribers.eight ?? 0} />
            <Stat label={ui("Le Pulpo Fat")} value={data?.subscribers.fat ?? 0} />
            <Stat label={ui("Canceling")} value={totals?.canceling ?? 0} />
            <Stat label={ui("Past due")} value={totals?.pastDue ?? 0} alert={(totals?.pastDue ?? 0) > 0} />
            <Stat label={ui("Billing holds")} value={totals?.holds ?? 0} alert={(totals?.holds ?? 0) > 0} />
            <Stat label={ui("Failed webhooks")} value={totals?.failedWebhooks ?? 0} alert={(totals?.failedWebhooks ?? 0) > 0} />
          </div>
        </Panel>
        <Panel
          icon={<WalletCards className="size-3" />}
          title={ui("Plan defaults")}
          extra={<Button size="sm" onClick={() => void saveDefaults()} disabled={saving || !limitsAreValid}>{saving ? ui("Saving…") : ui("Save")}</Button>}
        >
          <div className="space-y-3 px-3 py-3">
            <p className="text-xs text-muted-foreground">{ui("USD values are internal. Users only see the percentage remaining.")}</p>
            <p className="text-xs font-medium">{ui("Weekly limits")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <LimitInput label={ui("Pulpo Eight")} value={eightLimit} onChange={setEightLimit} />
              <LimitInput label={ui("Le Pulpo Fat")} value={fatLimit} onChange={setFatLimit} />
            </div>
            <p className="pt-1 text-xs font-medium">{ui("5-hour limits")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <LimitInput label={ui("Pulpo Eight")} value={eightFiveHourLimit} onChange={setEightFiveHourLimit} />
              <LimitInput label={ui("Le Pulpo Fat")} value={fatFiveHourLimit} onChange={setFatFiveHourLimit} />
            </div>
            <p className="pt-1 text-xs font-medium">{ui("Shared usage")}</p>
            <p className="text-xs text-muted-foreground">{ui("Pool members can draw this share of a Fat subscriber's weekly usage, each within their own 5-hour limit.")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <PercentInput label={ui("Share of Fat weekly")} value={sharedPercent} onChange={setSharedPercent} />
              <LimitInput label={ui("5-hour limit per member")} value={sharedFiveHourLimit} onChange={setSharedFiveHourLimit} />
            </div>
            <p className="pt-1 text-xs text-muted-foreground">{ui("File storage allowances apply immediately to users without an override.")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <StorageInput label={ui("Pulpo Baby")} value={babyStorage} onChange={setBabyStorage} />
              <StorageInput label={ui("Pulpo Eight")} value={eightStorage} onChange={setEightStorage} />
              <StorageInput label={ui("Le Pulpo Fat")} value={fatStorage} onChange={setFatStorage} />
            </div>
          </div>
        </Panel>
      </div>

      {settingsQuery.data && <UsageTiersPanel tiers={settingsQuery.data.usageTiers} onSaved={() => void settingsQuery.refetch()} />}

      <CustomLimitsPanel />

      <Panel icon={<CreditCard className="size-3" />} title={ui("Recent payments")} extra={<span className="text-xs text-muted-foreground">{(data?.recentOrders.length ?? 0).toLocaleString(activeLocale())}</span>}>
        {data?.recentOrders.length ? (
          <div className="max-h-96 overflow-auto">
            <table className="data-table min-w-max">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-normal">{ui("User")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Reason")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Product")}</th>
                  <th className="px-3 py-2 text-right font-normal">{ui("Amount")}</th>
                  <th className="px-3 py-2 text-right font-normal">{ui("Credits")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Status")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Date")}</th>
                  <th className="px-3 py-2 text-right font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.recentOrders.map((order) => (
                  <tr key={order.paymentId}>
                    <td className="max-w-48 px-3 py-2">
                      <div className="truncate">{order.userName}</div>
                      <div className="truncate text-muted-foreground">{order.userEmail}</div>
                    </td>
                    <td className="px-3 py-2">{humanReason(order.billingReason)}</td>
                    <td className="px-3 py-2"><ProductBadge product={order.product} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatBalance(order.totalAmountCents / 100)}
                      {order.taxAmountCents > 0 && <div className="text-muted-foreground">{formatBalance(order.taxAmountCents / 100)} {ui("tax")}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{order.grantedCreditMicros > 0 ? formatBalance(order.grantedCreditMicros / 1_000_000) : '—'}</td>
                    <td className="px-3 py-2"><Badge variant={order.refundedAmountCents > 0 ? 'destructive' : 'outline'}>{order.refundedAmountCents > 0 ? ui("refunded") : order.status}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(Date.parse(order.createdAt))}</td>
                    <td className="px-3 py-2 text-right">{stripeMode && order.provider === 'stripe' && <StripeLink href={stripePaymentUrl(stripeMode, order.paymentId)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
      </Panel>

      <Panel icon={<Repeat2 className="size-3" />} title={ui("Recent subscriptions")} extra={<span className="text-xs text-muted-foreground">{(data?.recentSubscriptions.length ?? 0).toLocaleString(activeLocale())}</span>}>
        {data?.recentSubscriptions.length ? (
          <div className="max-h-96 overflow-auto">
            <table className="data-table min-w-max">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-normal">{ui("User")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Plan")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Status")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Paid through")}</th>
                  <th className="px-3 py-2 font-normal">{ui("Period end")}</th>
                  <th className="px-3 py-2 text-right font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.recentSubscriptions.map((row) => (
                  <tr key={row.subscriptionId}>
                    <td className="max-w-48 px-3 py-2">
                      <div className="truncate">{row.userName}</div>
                      <div className="truncate text-muted-foreground">{row.userEmail}</div>
                    </td>
                    <td className="px-3 py-2"><ProductBadge product={row.plan} /></td>
                    <td className="px-3 py-2"><Badge variant={row.status === 'past_due' ? 'destructive' : 'outline'}>{row.cancelAtPeriodEnd ? ui("canceling") : row.status}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.paidThrough ? formatDate(Date.parse(row.paidThrough)) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.currentPeriodEnd ? formatDate(Date.parse(row.currentPeriodEnd)) : '—'}</td>
                    <td className="px-3 py-2 text-right">{stripeMode && row.provider === 'stripe' && <StripeLink href={stripeSubscriptionUrl(stripeMode, row.subscriptionId)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={<AlertTriangle className="size-3" />} title={ui("Failed webhooks")} extra={stripeMode && <StripeLink href={stripeWebhooksUrl(stripeMode)} label={ui("Stripe deliveries")} />}>
          {data?.failedEvents.length ? (
            <div className="max-h-96 divide-y overflow-y-auto">
              {data.failedEvents.map((event) => (
                <div key={event.providerEventId} className="space-y-1 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span>{event.type}</span>
                    <span className="text-muted-foreground">{formatDate(Date.parse(event.receivedAt))}</span>
                  </div>
                  {event.resourceId && <div className="truncate font-mono text-[11px] text-muted-foreground">{event.resourceId}</div>}
                  {event.error && <div className="text-destructive">{event.error}</div>}
                </div>
              ))}
            </div>
          ) : <Empty label={ui("No failed webhooks.")} />}
        </Panel>
        <Panel icon={<AlertTriangle className="size-3" />} title={ui("Billing holds")}>
          {data?.holds.length ? (
            <div className="max-h-96 divide-y overflow-y-auto">
              {data.holds.map((hold) => (
                <div key={hold.userId} className="flex items-start gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{hold.userName}</div>
                    <div className="truncate text-muted-foreground">{hold.userEmail}</div>
                    <div className="mt-1 text-muted-foreground">{hold.holdReason?.replaceAll('_', ' ') ?? ui("hold")}{hold.holdAt ? uit` · ${formatDate(Date.parse(hold.holdAt))}` : ''}</div>
                    {hold.holdReference && <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{hold.holdReference}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {stripeMode && hold.holdReference && <StripeLink href={stripeDashboardUrl(stripeMode, `/search?query=${encodeURIComponent(hold.holdReference)}`)} />}
                    <Button size="sm" variant="outline" onClick={() => void clearHold(hold.userId)}>{ui("Clear")}</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty label={ui("No billing holds.")} />}
        </Panel>
      </div>

      <div className="text-xs text-muted-foreground">{ui("Last reconciled:")} {data?.reconciliation.lastReconciledAt ? new Date(data.reconciliation.lastReconciledAt).toLocaleString(activeLocale()) : ui("Never")}</div>
    </div>
  )
}

function humanReason(reason: string) {
  if (reason === 'purchase') return ui("Top-up")
  if (reason === 'auto_top_up') return ui("Auto top-up")
  if (reason === 'subscription_create') return ui("Subscription create")
  if (reason === 'subscription_cycle') return ui("Renewal")
  if (reason === 'subscription_update') return ui("Plan update")
  return reason.replaceAll('_', ' ')
}

function productLabel(product: ProductKind | 'eight' | 'fat') {
  if (product === 'fat') return ui("Fat")
  if (product === 'eight') return ui("Eight")
  if (product === 'credits') return ui("Top-up")
  return ui("Other")
}

function ProductBadge({ product }: { product: ProductKind | 'eight' | 'fat' }) {
  return <Badge variant={product === 'fat' ? 'secondary' : 'outline'}>{productLabel(product)}</Badge>
}

function StripeLink({ href, label = 'Stripe' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {label}<ExternalLink className="size-3" />
    </a>
  )
}

function Panel({ icon, title, extra, children }: { icon: ReactNode; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-xs font-medium">{title}</h3>
        </div>
        {extra}
      </div>
      {children}
    </div>
  )
}

interface UsageTierDraft { paid: string; days: string; limit: string }

function usageTierDrafts(tiers: UsageTier[]): UsageTierDraft[] {
  return tiers.map((tier) => ({
    paid: (tier.minPaidCents / 100).toFixed(2),
    days: String(tier.minDaysSinceFirstPayment),
    limit: (tier.dailyLimitMicros / 1_000_000).toFixed(2),
  }))
}

/** Parses the drafts, or returns null when a value is invalid or a requirement decreases. */
function parseUsageTierDrafts(drafts: UsageTierDraft[]): UsageTier[] | null {
  const tiers = drafts.map((draft, index) => ({
    minPaidCents: index === 0 ? 0 : Math.round(Number(draft.paid) * 100),
    minDaysSinceFirstPayment: index === 0 ? 0 : Number(draft.days),
    dailyLimitMicros: Math.round(Number(draft.limit) * 1_000_000),
  }))
  const valid = tiers.length > 0 && tiers.every((tier, index) => {
    const previous = tiers[index - 1]
    return Number.isFinite(tier.minPaidCents) && tier.minPaidCents >= 0
      && Number.isInteger(tier.minDaysSinceFirstPayment) && tier.minDaysSinceFirstPayment >= 0 && tier.minDaysSinceFirstPayment <= 3_650
      && Number.isFinite(tier.dailyLimitMicros) && tier.dailyLimitMicros >= 0
      && (!previous || (tier.minPaidCents >= previous.minPaidCents && tier.minDaysSinceFirstPayment >= previous.minDaysSinceFirstPayment))
  })
  return valid ? tiers : null
}

function UsageTiersPanel({ tiers, onSaved }: { tiers: UsageTier[]; onSaved: () => void }) {
  const [drafts, setDrafts] = useState(() => usageTierDrafts(tiers))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { setDrafts(usageTierDrafts(tiers)) }, [tiers])
  const parsed = parseUsageTierDrafts(drafts)
  const update = (index: number, patch: Partial<UsageTierDraft>) => setDrafts((current) => current.map((draft, i) => i === index ? { ...draft, ...patch } : draft))

  const save = async () => {
    if (!parsed) return
    setSaving(true)
    setMessage('')
    try {
      await apiRequest('/api/admin/billing/settings', { method: 'PATCH', body: { usageTiers: parsed } })
      setMessage(ui("Usage tiers saved."))
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ui("Could not save usage tiers."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      icon={<Gauge className="size-3" />}
      title={ui("Usage tiers")}
      extra={<Button size="sm" onClick={() => void save()} disabled={saving || !parsed}>{saving ? ui("Saving…") : ui("Save")}</Button>}
    >
      <div className="space-y-3 px-3 py-3">
        <p className="text-xs text-muted-foreground">{ui("Each tier caps a user's total daily spend, including plan usage and credits. Users move up once their lifetime payments before tax, net of refunds, and the days since their first payment both meet a tier. A daily limit never falls below the user's plan weekly allowance. Admins are exempt.")}</p>
        <div className="overflow-x-auto">
          <table className="data-table min-w-max text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-normal">{ui("Tier")}</th>
                <th className="px-2 py-1.5 text-left font-normal">{ui("Total paid")}</th>
                <th className="px-2 py-1.5 text-left font-normal">{ui("Days since first payment")}</th>
                <th className="px-2 py-1.5 text-left font-normal">{ui("Daily limit")}</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft, index) => (
                <tr key={index}>
                  <td className="px-2 py-1.5 tabular-nums">{index}</td>
                  <td className="px-2 py-1.5"><DollarInput aria-label={ui("Total paid for tier {{tier}}", { tier: index })} value={draft.paid} disabled={index === 0} onChange={(paid) => update(index, { paid })} /></td>
                  <td className="px-2 py-1.5"><Input aria-label={ui("Days since first payment for tier {{tier}}", { tier: index })} className="h-8 w-24 text-xs tabular-nums" type="number" min="0" step="1" value={draft.days} disabled={index === 0} onChange={(event) => update(index, { days: event.target.value })} /></td>
                  <td className="px-2 py-1.5"><DollarInput aria-label={ui("Daily limit for tier {{tier}}", { tier: index })} value={draft.limit} onChange={(limit) => update(index, { limit })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={drafts.length >= 10} onClick={() => setDrafts((current) => [...current, { ...current[current.length - 1]! }])}><Plus />{ui("Add tier")}</Button>
          <Button size="sm" variant="ghost" disabled={drafts.length <= 1} onClick={() => setDrafts((current) => current.slice(0, -1))}><Minus />{ui("Remove last tier")}</Button>
          {!parsed && <span className="text-xs text-destructive">{ui("Requirements cannot decrease from one tier to the next.")}</span>}
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
        </div>
      </div>
    </Panel>
  )
}

type CustomLimitTarget = 'everyone' | 'plans' | 'users'

interface CustomLimit {
  id: string
  name: string
  period: CustomLimitPeriod
  limitMicros: number
  modelIds: string[]
  target: CustomLimitTarget
  plans: BillingPlan[]
  userIds: string[]
  enabled: boolean
}

type CustomLimitInput = Omit<CustomLimit, 'id'>

const CUSTOM_LIMIT_PERIODS: CustomLimitPeriod[] = ['five_hour', 'daily', 'weekly']
const BILLING_PLANS: BillingPlan[] = ['baby', 'eight', 'fat']

function customLimitPeriodLabel(period: CustomLimitPeriod) {
  if (period === 'five_hour') return ui("5 hours (rolling)")
  if (period === 'daily') return ui("Daily")
  return ui("Weekly")
}

function customLimitInput(limit: CustomLimit): CustomLimitInput {
  const { id: _id, ...input } = limit
  return input
}

function CustomLimitsPanel() {
  const [editing, setEditing] = useState<CustomLimit | 'new' | null>(null)
  const [message, setMessage] = useState('')
  const limitsQuery = useQuery({
    queryKey: ['admin-billing-custom-limits'],
    queryFn: () => apiRequest<{ data: CustomLimit[] }>('/api/admin/billing/custom-limits'),
  })
  const modelsQuery = useQuery({
    queryKey: ['admin-billing-custom-limit-models'],
    queryFn: async ({ signal }) => (await apiRequest<{ data: { id: string; name: string }[] }>('/api/admin/models', { signal }))
      .data.map(({ id, name }) => ({ id, name })),
  })
  const limits = limitsQuery.data?.data ?? []
  const directory = useAdminUserDirectory(editing !== null || limits.some((limit) => limit.target === 'users'))
  const modelName = (id: string) => modelsQuery.data?.find((model) => model.id === id)?.name ?? id

  const save = async (id: string | null, input: CustomLimitInput) => {
    await apiRequest(id ? `/api/admin/billing/custom-limits/${id}` : '/api/admin/billing/custom-limits', {
      method: id ? 'PATCH' : 'POST',
      body: input,
    })
    await limitsQuery.refetch()
  }

  const toggle = async (limit: CustomLimit, enabled: boolean) => {
    setMessage('')
    try {
      await save(limit.id, { ...customLimitInput(limit), enabled })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ui("Could not update the limit."))
    }
  }

  const remove = async (limit: CustomLimit) => {
    if (!confirm(ui("Delete the “{{name}}” limit?", { name: limit.name }))) return
    setMessage('')
    try {
      await apiRequest(`/api/admin/billing/custom-limits/${limit.id}`, { method: 'DELETE' })
      await limitsQuery.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ui("Could not delete the limit."))
    }
  }

  const audience = (limit: CustomLimit) => {
    if (limit.target === 'everyone') return ui("Everyone")
    if (limit.target === 'plans') return limit.plans.map(billingPlanName).join(', ')
    const names = limit.userIds.map((id) => directory.users.find((user) => user.id === id)?.name).filter(Boolean)
    return names.length === limit.userIds.length && names.length <= 2
      ? names.join(', ')
      : ui("{{count}} users", { count: limit.userIds.length })
  }

  return (
    <Panel
      icon={<SlidersHorizontal className="size-3" />}
      title={ui("Custom limits")}
      extra={<Button size="sm" variant="outline" onClick={() => setEditing('new')}><Plus />{ui("Add limit")}</Button>}
    >
      <div className="space-y-3 px-3 py-3">
        <p className="text-xs text-muted-foreground">{ui("Each limit caps what the users it covers spend on its models within its period, whether plan usage, credits, or a pool pays. Users see the percentage left with their other limits on the billing page. Admins are exempt unless you choose them as specific users.")}</p>
        {limitsQuery.isError && <p className="text-xs text-destructive">{ui("Could not load custom limits.")}</p>}
        {limits.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-max text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-normal">{ui("Name")}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{ui("Limit")}</th>
                  <th className="px-2 py-1.5 font-normal">{ui("Period")}</th>
                  <th className="px-2 py-1.5 font-normal">{ui("Models")}</th>
                  <th className="px-2 py-1.5 font-normal">{ui("Applies to")}</th>
                  <th className="px-2 py-1.5 font-normal">{ui("Enabled")}</th>
                  <th className="px-2 py-1.5 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {limits.map((limit) => (
                  <tr key={limit.id} className={limit.enabled ? undefined : 'text-muted-foreground'}>
                    <td className="max-w-48 truncate px-2 py-1.5">{limit.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatBalance(limit.limitMicros / 1_000_000)}</td>
                    <td className="px-2 py-1.5">{customLimitPeriodLabel(limit.period)}</td>
                    <td className="max-w-56 truncate px-2 py-1.5">{limit.modelIds.length ? limit.modelIds.map(modelName).join(', ') : ui("All models")}</td>
                    <td className="max-w-48 truncate px-2 py-1.5">{audience(limit)}</td>
                    <td className="px-2 py-1.5"><Switch checked={limit.enabled} aria-label={ui("Enable {{name}}", { name: limit.name })} onCheckedChange={(enabled) => void toggle(limit, enabled)} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <Button size="icon-sm" variant="ghost" aria-label={ui("Edit {{name}}", { name: limit.name })} onClick={() => setEditing(limit)}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label={ui("Delete {{name}}", { name: limit.name })} onClick={() => void remove(limit)}><Trash2 /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !limitsQuery.isPending && !limitsQuery.isError && <p className="text-xs text-muted-foreground">{ui("No custom limits yet.")}</p>}
        {message && <p className="text-xs text-destructive">{message}</p>}
      </div>
      {editing !== null && <CustomLimitDialog
        limit={editing === 'new' ? null : editing}
        models={modelsQuery.data ?? []}
        directory={directory}
        onSave={(input) => save(editing === 'new' ? null : editing.id, input)}
        onClose={() => setEditing(null)}
      />}
    </Panel>
  )
}

function CustomLimitDialog({ limit, models, directory, onSave, onClose }: {
  limit: CustomLimit | null
  models: Array<{ id: string; name: string }>
  directory: UserDirectory
  onSave: (input: CustomLimitInput) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(limit?.name ?? '')
  const [amount, setAmount] = useState(limit ? (limit.limitMicros / 1_000_000).toFixed(2) : '5.00')
  const [period, setPeriod] = useState<CustomLimitPeriod>(limit?.period ?? 'daily')
  const [allModels, setAllModels] = useState(!limit?.modelIds.length)
  const [modelIds, setModelIds] = useState(limit?.modelIds ?? [])
  const [target, setTarget] = useState<CustomLimitTarget>(limit?.target ?? 'everyone')
  const [plans, setPlans] = useState<BillingPlan[]>(limit?.plans ?? [])
  const [userIds, setUserIds] = useState(limit?.userIds ?? [])
  const [enabled, setEnabled] = useState(limit?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const limitMicros = Math.round(Number(amount) * 1_000_000)
  const toggleIn = <T,>(values: T[], value: T, checked: boolean) => checked ? [...values, value] : values.filter((item) => item !== value)
  const problem = !name.trim()
    ? ui("Enter a name.")
    : amount.trim() === '' || !Number.isFinite(limitMicros) || limitMicros < 0
      ? ui("Enter a limit of $0.00 or more.")
      : !allModels && !modelIds.length
        ? ui("Choose at least one model.")
        : target === 'plans' && !plans.length
          ? ui("Choose at least one plan.")
          : target === 'users' && !userIds.length
            ? ui("Choose at least one user.")
            : null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (problem || saving) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(), period, limitMicros, enabled, target,
        modelIds: allModels ? [] : modelIds,
        plans: target === 'plans' ? plans : [],
        userIds: target === 'users' ? userIds : [],
      })
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : ui("Could not save the limit."))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{limit ? ui("Edit custom limit") : ui("Add custom limit")}</DialogTitle>
            <DialogDescription>{ui("Cap spending on some or all models for everyone, a subscription plan, or specific users.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="custom-limit-name">{ui("Name")}</Label>
            <Input id="custom-limit-name" value={name} maxLength={80} placeholder={ui("Shown to users, like “Opus daily”")} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="custom-limit-amount">{ui("Limit")}</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input id="custom-limit-amount" className="w-full pl-6 tabular-nums" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-limit-period">{ui("Period")}</Label>
              <Select value={period} onValueChange={(value) => setPeriod(value as CustomLimitPeriod)}>
                <SelectTrigger id="custom-limit-period" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CUSTOM_LIMIT_PERIODS.map((option) => <SelectItem key={option} value={option}>{customLimitPeriodLabel(option)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{period === 'five_hour'
            ? ui("Counts usage from the last 5 hours.")
            : period === 'daily' ? ui("Resets at 00:00 UTC.") : ui("Resets Monday at 00:00 UTC.")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="custom-limit-models">{ui("Models")}</Label>
            <Select value={allModels ? 'all' : 'selected'} onValueChange={(value) => setAllModels(value === 'all')}>
              <SelectTrigger id="custom-limit-models" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ui("All models")}</SelectItem>
                <SelectItem value="selected">{ui("Selected models")}</SelectItem>
              </SelectContent>
            </Select>
            {!allModels && <div role="group" aria-label={ui("Models")} className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {models.map((model) => <label key={model.id} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={modelIds.includes(model.id)} onChange={(event) => setModelIds((current) => toggleIn(current, model.id, event.target.checked))} />
                <span className="truncate">{model.name}</span>
              </label>)}
              {!models.length && <p className="text-xs text-muted-foreground">{ui("Loading models…")}</p>}
            </div>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-limit-target">{ui("Applies to")}</Label>
            <Select value={target} onValueChange={(value) => setTarget(value as CustomLimitTarget)}>
              <SelectTrigger id="custom-limit-target" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="everyone">{ui("Everyone")}</SelectItem>
                <SelectItem value="plans">{ui("Subscription plans")}</SelectItem>
                <SelectItem value="users">{ui("Specific users")}</SelectItem>
              </SelectContent>
            </Select>
            {target === 'plans' && <div role="group" aria-label={ui("Subscription plans")} className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border p-2">
              {BILLING_PLANS.map((plan) => <label key={plan} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={plans.includes(plan)} onChange={(event) => setPlans((current) => toggleIn(current, plan, event.target.checked))} />
                {billingPlanName(plan)}
              </label>)}
            </div>}
            {target === 'users' && <UserListEditor
              title={ui("Users")}
              emptyText={ui("No users selected.")}
              includeAdmins
              userIds={userIds}
              directory={directory}
              onChange={setUserIds}
            />}
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            {ui("Enabled")}
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
          {(error || (problem && name)) && <p className="text-xs text-destructive">{error || problem}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
            <Button type="submit" disabled={saving || problem !== null}>{saving ? ui("Saving…") : ui("Save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DollarInput({ value, onChange, disabled, 'aria-label': ariaLabel }: { value: string; onChange: (value: string) => void; disabled?: boolean; 'aria-label': string }) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
      <Input aria-label={ariaLabel} className="h-8 w-28 pl-6 text-xs tabular-nums" type="number" min="0" step="0.01" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${alert ? 'font-medium text-destructive' : ''}`}>{value}</span>
    </div>
  )
}

function LimitInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input className="h-8 w-28 pl-6 text-xs tabular-nums" type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  )
}

function PercentInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative">
        <Input className="h-8 w-28 pr-7 text-xs tabular-nums" type="number" min="0" max="100" step="1" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
    </label>
  )
}

function StorageInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative">
        <Input className="h-8 w-28 pr-9 text-xs tabular-nums" type="number" min="0" step="1" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{ui("GiB")}</span>
      </div>
    </label>
  )
}

function Empty({ label = 'No data yet.' }: { label?: string }) {
  return <div className="p-6 text-center text-xs text-muted-foreground">{label}</div>
}

function axisCost(value: number) {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(3)}`
  if (value < 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(1)}`
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      <div className="mt-1 text-muted-foreground"> {ui("Collected:")} <span className="font-medium text-foreground tabular-nums">{formatBalance(Number(payload[0]?.value ?? 0))}</span>
      </div>
    </div>
  )
}
