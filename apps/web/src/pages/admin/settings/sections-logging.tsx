import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SaveBar, Section, SelectField, Toggle } from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { ui } from '@/i18n/ui'

export function LoggingSection() {
  const [enabled, setEnabled] = useState(false)
  const [retention, setRetention] = useState('7d')
  useEffect(() => { void apiRequest<{ values: Record<string, unknown> }>('/api/admin/settings').then((result) => { const value = result.values.logging as { logDetailedPayloads?: boolean; payloadRetention?: string } | undefined; setEnabled(value?.logDetailedPayloads ?? false); setRetention(value?.payloadRetention ?? '7d') }) }, [])
  return <div>
    <Section title={ui("Request logging")} hint="Operational metadata, errors, timing, token counts, cost, retry, fallback, and OCR state are always retained.">
      <Toggle label={ui("Log detailed payloads")} hint="Default is off. Captures exact upstream request and response bodies for new requests." checked={enabled} onChange={setEnabled} />
      <SelectField label={ui("Detailed payload retention")} value={retention} onChange={setRetention} options={[{ value: '1h', label: ui("1 hour") }, { value: '24h', label: ui("24 hours") }, { value: '7d', label: ui("7 days") }, { value: '30d', label: ui("30 days") }, { value: '90d', label: ui("90 days") }, { value: 'indefinite', label: ui("Indefinite") }]} />
    </Section>
    <div className="mb-4 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><div className="font-medium">{ui("Sensitive data warning")}</div><p className="mt-1 text-xs text-muted-foreground">{ui("Exact payload logging may retain prompts, outputs, reasoning, tool data, file references, and OCR image data. Turning it off stops new capture; retained bodies are cleared when their configured retention expires.")}</p></div></div>
    <SaveBar onSave={() => apiRequest('/api/admin/settings', { method: 'PATCH', body: { logging: { logDetailedPayloads: enabled, payloadRetention: retention } } })} />
  </div>
}
