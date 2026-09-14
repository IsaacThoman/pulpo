import { DiagnosticAttempts } from '../DiagnosticAttempts'
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SaveBar, Section, SelectField, Toggle, Field } from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { ui } from '@/i18n/ui'

interface CleanupStatus { lastSuccessAt: string | null; clearedRecords: number; overdueRecords: number; oldestOverdueAt: string | null; consecutiveFailures: number; alert: string | null }

export function LoggingSection() {
  const [enabled, setEnabled] = useState(false)
  const [health, setHealth] = useState<CleanupStatus | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  useEffect(() => { let active = true; const refresh = () => apiRequest<CleanupStatus>('/api/admin/usage/diagnostics/retention').then(value => { if (active) { setHealth(value); setHealthError(null) } }).catch(() => { if (active) setHealthError('Unable to read cleanup status') }); void refresh(); const timer = setInterval(() => { void refresh() }, 30_000); return () => { active = false; clearInterval(timer) } }, [])
  const [retention, setRetention] = useState('7d')
  useEffect(() => { void apiRequest<{ values: Record<string, unknown> }>('/api/admin/settings').then((result) => { const value = result.values.logging as { logDetailedPayloads?: boolean; payloadRetention?: string } | undefined; setEnabled(value?.logDetailedPayloads ?? false); setRetention(value?.payloadRetention ?? '7d') }) }, [])
  return <div>
    <Section title={ui("Request logging")} hint="Operational metadata, errors, timing, token counts, cost, retry, fallback, and OCR state are always retained.">
      <Toggle label={ui("Log detailed payloads")} hint="Default is off. Captures bounded diagnostic copies per attempt. Payloads are labeled exact, redacted, reconstructed, or truncated. Credentials and binary media are omitted." checked={enabled} onChange={setEnabled} />
      <SelectField width="w-32 sm:w-64" label={ui("Diagnostic payload retention")} value={retention} onChange={setRetention} options={[{ value: '1h', label: ui("1 hour") }, { value: '24h', label: ui("24 hours") }, { value: '7d', label: ui("7 days") }, { value: '30d', label: ui("30 days") }, { value: '90d', label: ui("90 days") }, { value: 'indefinite', label: ui("Indefinite") }]} />
    </Section>
    <div className="mb-4 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><div className="font-medium">{ui("Sensitive data warning")}</div><p className="mt-1 text-xs text-muted-foreground">{ui("Diagnostic payloads may contain prompts, responses, reasoning, and tool inputs/output. Turning logging off clears these diagnostic copies; changing retention recalculates deadlines from collection time. Chat history, attachments, saved agent context, and existing backups have separate lifetimes.")}</p></div></div>
    <Section title={ui('Diagnostic cleanup')} hint="Expired bodies become unavailable immediately and are cleared from the database every minute.">
      {healthError && <p role="alert" className="text-sm text-destructive">{healthError}</p>}
      {health?.alert && <p role="alert" className="text-sm text-destructive">{health.alert}</p>}
      <Field label={ui('Last successful cleanup')}><span className="text-xs">{health?.lastSuccessAt ? new Date(health.lastSuccessAt).toLocaleString() : ui('Not yet reported')}</span></Field>
      <Field label={ui('Records cleared last run')}><span className="text-sm tabular-nums">{health?.clearedRecords ?? '—'}</span></Field>
      <Field label={ui('Overdue records')}><span className="text-sm tabular-nums">{health?.overdueRecords ?? '—'}</span></Field>
      <Field label={ui('Consecutive failures')}><span className="text-sm tabular-nums">{health?.consecutiveFailures ?? '—'}</span></Field>
    </Section>
    <SaveBar onSave={() => apiRequest('/api/admin/settings', { method: 'PATCH', body: { logging: { logDetailedPayloads: enabled, payloadRetention: retention } } })} />
    <div className="mt-7"><DiagnosticAttempts /></div>
  </div>
}
