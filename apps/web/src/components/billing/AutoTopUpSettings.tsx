import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/lib/api'
import type { AutoTopUpSummary } from '@/lib/billing'
import { chargeCentsForCredits, creditCentsFromInput } from '@/lib/billing-pricing'
import { formatBalance } from '@/lib/format'
import { openExternalUrl } from '@/lib/runtime'
import { queryClient } from '@/lib/query-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { activeLocale, ui } from '@/i18n/ui'

const money = (cents: number) => formatBalance(cents / 100)
export function AutoTopUpSettings({ value, userId }: { value: AutoTopUpSummary; userId: string }) {
  const [params, setParams] = useSearchParams()
  const configureButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(value.enabled)
  const [threshold, setThreshold] = useState((value.thresholdCents / 100).toFixed(2))
  const [amount, setAmount] = useState((value.creditCents / 100).toFixed(2))
  const [limit, setLimit] = useState((value.monthlyLimitCents / 100).toFixed(2))
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing', userId] })
  useEffect(() => {
    if (params.get('auto_top_up') !== 'setup') return
    let canceled = false
    void apiRequest('/api/billing/auto-top-up/setup/confirm', { method: 'POST' }).then(async () => {
      await queryClient.invalidateQueries({ queryKey: ['billing', userId] })
      if (!canceled) setParams(current => { current.delete('auto_top_up'); return current }, { replace: true })
    }).catch(err => { if (!canceled) setError(err instanceof Error ? err.message : ui('Could not confirm your saved card. Refresh Billing to try again.')) })
    return () => { canceled = true }
  }, [params, setParams, userId])
  const configure = () => {
    setEnabled(value.enabled); setThreshold((value.thresholdCents / 100).toFixed(2)); setAmount((value.creditCents / 100).toFixed(2))
    setLimit((value.monthlyLimitCents / 100).toFixed(2)); setConsent(false); setError(''); setOpen(true)
  }
  const thresholdCents = creditCentsFromInput(threshold)
  const creditCents = creditCentsFromInput(amount)
  const monthlyLimitCents = creditCentsFromInput(limit)
  const valid = thresholdCents !== null && creditCents !== null && monthlyLimitCents !== null
    && thresholdCents > 0 && thresholdCents <= creditCents && creditCents >= 500 && creditCents <= 50000
    && monthlyLimitCents >= chargeCentsForCredits(creditCents) && monthlyLimitCents <= 2147483647
    && monthlyLimitCents >= value.chargedCents + value.pendingCents
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await operation() } catch (err) { setError(err instanceof Error ? err.message : ui('Could not update automatic top-ups.')) }
    finally { setBusy(false); await refresh() }
  }
  const save = () => run(async () => {
    const saved = await apiRequest<AutoTopUpSummary>('/api/billing/auto-top-up', { method: 'PATCH', body: {
      enabled: enabled && Boolean(value.card), thresholdCents, creditCents, monthlyLimitCents,
      revision: value.revision, consent, resume: enabled && value.status === 'payment_issue',
    } })
    if (enabled && !value.card) {
      const setup = await apiRequest<{ url: string }>('/api/billing/auto-top-up/setup', { method: 'POST', body: {
        revision: saved.revision, enable: true, consent: true, idempotencyKey: crypto.randomUUID(),
      } })
      await openExternalUrl(setup.url)
    }
    setOpen(false)
  })
  const updateCard = () => run(async () => {
    const setup = await apiRequest<{ url: string }>('/api/billing/auto-top-up/setup', { method: 'POST', body: {
      revision: value.revision, enable: false, consent: true, idempotencyKey: crypto.randomUUID(),
    } })
    await openExternalUrl(setup.url)
  })
  const disable = () => run(async () => {
    await apiRequest('/api/billing/auto-top-up', { method: 'PATCH', body: {
      enabled: false, thresholdCents: value.thresholdCents, creditCents: value.creditCents, monthlyLimitCents: value.monthlyLimitCents, revision: value.revision,
    } })
  })
  const status = value.status === 'processing' ? ui('Processing a top-up') : value.status === 'payment_issue' ? ui('Paused: payment needs attention')
    : value.status === 'limit_reached' ? ui('Monthly limit reached') : value.enabled ? ui('Active') : ui('Off')
  return <section className="space-y-3 border-t pt-5" aria-label={ui('Automatic top-ups')}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{ui('Automatic top-ups')}</h3><span className="text-xs text-muted-foreground">{status}</span></div>
    <p className="text-xs text-muted-foreground">{ui('Add {{amount}} in credits when your available personal balance falls below {{threshold}}.', { amount: money(value.creditCents), threshold: money(value.thresholdCents) })}</p>
    <p className="text-xs text-muted-foreground">{ui('{{spent}} charged of {{limit}} this month. {{pending}} pending.', { spent: money(value.chargedCents), limit: money(value.monthlyLimitCents), pending: money(value.pendingCents) })}</p>
    <p className="text-xs text-muted-foreground">{ui('Resets {{date}} at 00:00 UTC. Includes fees and tax; excludes manual purchases and subscriptions.', { date: new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value.resetsAt)) })}</p>
    {value.card && <p className="text-xs text-muted-foreground">{ui('{{brand}} ending in {{last4}}', { brand: value.card.brand, last4: value.card.last4 })}</p>}
    {value.status === 'payment_issue' && <p className="text-xs text-destructive">{ui('Update your card if needed, then open settings to authorize and resume automatic top-ups.')}</p>}
    {value.status === 'limit_reached' && <p className="text-xs text-muted-foreground">{ui('The remaining budget cannot cover a full top-up. Increase your limit or wait until next month.')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button ref={configureButton} size="sm" variant="outline" onClick={configure} disabled={busy}><RefreshCw className="size-3.5" />{ui('Configure top-ups')}</Button>
      {value.card && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void updateCard()}>{ui('Update card')}</Button>}
      {value.enabled && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disable()}>{ui('Disable')}</Button>}
    </div>
    {error && !open && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md" onCloseAutoFocus={event => { event.preventDefault(); configureButton.current?.focus() }}>
      <DialogHeader><DialogTitle>{ui('Automatic top-ups')}</DialogTitle><DialogDescription>{ui('Keep your personal credit balance funded, within a monthly spending limit.')}</DialogDescription></DialogHeader>
      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between gap-3"><Label htmlFor="auto-top-up-enabled">{ui('Enable automatic top-ups')}</Label><Switch id="auto-top-up-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={busy} /></div>
        {[
          { id: 'threshold', label: ui('When balance falls below ($)'), value: threshold, set: setThreshold },
          { id: 'amount', label: ui('Credits to add ($)'), value: amount, set: setAmount },
          { id: 'limit', label: ui('Monthly spending limit ($)'), value: limit, set: setLimit },
        ].map(field => <div key={field.id} className="space-y-2"><Label htmlFor={`auto-top-up-${field.id}`}>{field.label}</Label><Input id={`auto-top-up-${field.id}`} inputMode="decimal" value={field.value} disabled={busy} onChange={event => { if (/^\d*(?:\.\d{0,2})?$/.test(event.target.value)) field.set(event.target.value) }} /></div>)}
        <p className="text-xs text-muted-foreground">{ui('Add $5–$500 per top-up. The threshold cannot exceed that amount. The monthly limit must cover a full top-up, including fees, and any charges already made or pending.')}</p>
        <p className="text-xs text-muted-foreground">{ui('Each charge includes the existing 5% + $0.50 platform fee and applicable tax. A full top-up is skipped if it would exceed your limit.')}</p>
        {enabled && <Label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} className="mt-0.5" />{ui('I authorize automatic charges to my saved card under these settings. Enabling may charge immediately if my balance is low. The limit resets on the first of each month at 00:00 UTC.')}</Label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{ui('Cancel')}</Button><Button disabled={busy || !valid || (enabled && !consent)} onClick={() => void save()}>{enabled && !value.card ? ui('Save and set up card') : ui('Save settings')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>
}
