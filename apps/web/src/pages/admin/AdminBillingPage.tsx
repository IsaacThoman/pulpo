import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, ExternalLink, RefreshCw, Repeat2, UsersRound, WalletCards } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiRequest } from '@/lib/api'
import { formatBalance, formatDate } from '@/lib/format'
import { stripeDashboardUrl, stripePaymentUrl, stripeSubscriptionUrl, stripeWebhooksUrl, type StripeMode } from '@/lib/stripe-dashboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup } from '@/components/usage/ToggleGroup'
import { ui, uit, activeLocale } from '@/i18n/ui'
import { useSettings } from '@/stores/settings'
import { DEFAULT_CHART_ANIMATION_DURATION_MS, scaledAnimationDuration } from '@/lib/animation-speed'

type Range = '7d' | '30d' | '90d' | 'all'
type ProductKind = 'eight' | 'fat' | 'credits' | 'unknown'

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
    stripePaymentId: string
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
    stripeSubscriptionId: string
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
  babyStorageLimitBytes: number
  eightStorageLimitBytes: number
  fatStorageLimitBytes: number
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
  const chart = data?.trend.map((row) => ({ day: row.day.slice(5, 10), collected: row.totalCents / 100 })) ?? []
  const limitsAreValid = [eightLimit, fatLimit, eightFiveHourLimit, fatFiveHourLimit, babyStorage, eightStorage, fatStorage]
    .every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
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

      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6 lg:gap-0 lg:divide-x">
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
                <Bar dataKey="collected" fill="hsl(160 60% 45%)" maxBarSize={28} animationDuration={animationDuration} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-0 sm:divide-x">
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
            <p className="pt-1 text-xs text-muted-foreground">{ui("File storage allowances apply immediately to users without an override.")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <StorageInput label={ui("Pulpo Baby")} value={babyStorage} onChange={setBabyStorage} />
              <StorageInput label={ui("Pulpo Eight")} value={eightStorage} onChange={setEightStorage} />
              <StorageInput label={ui("Le Pulpo Fat")} value={fatStorage} onChange={setFatStorage} />
            </div>
          </div>
        </Panel>
      </div>

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
                  <tr key={order.stripePaymentId}>
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
                    <td className="px-3 py-2 text-right">{stripeMode && <StripeLink href={stripePaymentUrl(stripeMode, order.stripePaymentId)} />}</td>
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
                  <tr key={row.stripeSubscriptionId}>
                    <td className="max-w-48 px-3 py-2">
                      <div className="truncate">{row.userName}</div>
                      <div className="truncate text-muted-foreground">{row.userEmail}</div>
                    </td>
                    <td className="px-3 py-2"><ProductBadge product={row.plan} /></td>
                    <td className="px-3 py-2"><Badge variant={row.status === 'past_due' ? 'destructive' : 'outline'}>{row.cancelAtPeriodEnd ? ui("canceling") : row.status}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.paidThrough ? formatDate(Date.parse(row.paidThrough)) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.currentPeriodEnd ? formatDate(Date.parse(row.currentPeriodEnd)) : '—'}</td>
                    <td className="px-3 py-2 text-right">{stripeMode && <StripeLink href={stripeSubscriptionUrl(stripeMode, row.stripeSubscriptionId)} />}</td>
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
