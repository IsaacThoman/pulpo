import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

interface Attempt { id: string; purpose: string; modelId: string | null; status: string; createdAt: string; metadata: Record<string, unknown> }
export function DiagnosticAttempts({ requestId }: { requestId?: string }) {
  const [rows, setRows] = useState<Attempt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [payloads, setPayloads] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    try { const r = await apiRequest<{ data: Attempt[] }>(requestId ? `/api/admin/usage/requests/${requestId}/diagnostics` : '/api/admin/usage/diagnostics?limit=30'); setRows(r.data); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load diagnostics') }
  }, [requestId])
  useEffect(() => { void load() }, [load])
  return <div className="space-y-3 text-sm">
    <div className="flex items-center justify-between gap-3"><span className="font-medium">{ui('Provider and tool attempts')}</span><Button variant="outline" size="sm" onClick={() => void load()}>{ui('Refresh')}</Button></div>
    {error && <p role="alert" className="text-destructive">{ui(error)}</p>}
    {!rows.length && !error && <p className="text-xs text-muted-foreground">{ui('No diagnostic attempts recorded.')}</p>}
    {rows.map(row => <details key={row.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs">{new Date(row.createdAt).toLocaleString()} · {row.purpose.replaceAll('_', ' ')} · {row.modelId ?? 'tool'} · {row.status}</summary>
      <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(row.metadata, null, 2)}</pre>
      <Button variant="outline" size="sm" disabled={loading} onClick={async () => { setSelected(row.id); setPayloads(null); setLoading(true); try { setPayloads(await apiRequest(`/api/admin/usage/diagnostics/${row.id}/payloads`)); setError(null) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load payloads') } finally { setLoading(false) } }}>{ui('Inspect retained payloads')}</Button>
      {selected === row.id && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{payloads ? JSON.stringify(payloads, null, 2) : ui('Loading…')}</pre>}
    </details>)}
  </div>
}
