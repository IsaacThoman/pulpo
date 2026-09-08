import { useEffect, useState } from 'react'
import { OPENAI_SPEECH_PRESET, speechModelSchema, type SpeechModel } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'

export function AdminSpeechModelsPage() {
  const [models, setModels] = useState<SpeechModel[]>([])
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])
  const [draft, setDraft] = useState<SpeechModel | null>(null)
  const [editing, setEditing] = useState(false)
  const [voices, setVoices] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const load = async () => {
    const [catalog, connections] = await Promise.all([apiRequest<{ data: SpeechModel[] }>('/api/admin/speech-models'), apiRequest<{ data: Array<{ id: string; name: string }> }>('/api/admin/providers')])
    setModels(catalog.data); setProviders(connections.data)
  }
  useEffect(() => { void load().catch(error => setError(error.message)) }, [])
  const open = (model?: SpeechModel) => {
    const next = model ?? { ...OPENAI_SPEECH_PRESET, id: '', providerConnectionId: providers[0]?.id ?? '' }
    setDraft(next); setEditing(Boolean(model)); setVoices(next.voices.map(v => `${v.id} | ${v.label}`).join('\n')); setError('')
  }
  const field = (key: keyof SpeechModel, value: unknown) => setDraft(current => current ? { ...current, [key]: value } : current)
  const text = (key: 'id' | 'name' | 'upstreamModelId' | 'defaultVoice', label: string) => <label className="block text-sm">{ui(label)}<Input className="mt-1" disabled={key === 'id' && editing} value={draft?.[key] ?? ''} onChange={e => field(key, e.target.value)} /></label>
  const number = (key: keyof SpeechModel, label: string, price = false) => <label className="block text-sm">{ui(label)}<Input className="mt-1" type="number" min={0} step={price ? '0.000001' : 'any'} value={draft?.[key] === null ? '' : Number(draft?.[key] ?? 0) / (price ? 1e6 : 1)} onChange={e => field(key, e.target.value === '' && key === 'maxInputTokens' ? null : Math.round(Number(e.target.value) * (price ? 1e6 : 1) * 100) / 100)} /></label>
  const toggle = (key: keyof SpeechModel, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft?.[key])} onChange={e => field(key, e.target.checked)} />{ui(label)}</label>
  const save = async () => {
    if (!draft) return
    setSaving(true); setError('')
    try {
      const model = speechModelSchema.parse({ ...draft, voices: voices.split('\n').filter(line => line.trim()).map(line => { const [id, label] = line.split('|').map(s => s.trim()); return { id, label: label || id } }) })
      await apiRequest(editing ? `/api/admin/speech-models/${model.id}` : '/api/admin/speech-models', { method: editing ? 'PATCH' : 'POST', body: model })
      await load(); setDraft(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save speech model') }
    finally { setSaving(false) }
  }
  return <div className="space-y-5"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{ui('Speech models')}</h1><Button onClick={() => open()}>{ui('Add speech model')}</Button></div>
    <p className="text-sm text-muted-foreground">{ui('Configure voices and playback models using your provider connections. New entries start with editable OpenAI defaults and are disabled until enabled.')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {models.map(model => <div key={model.id} className="flex items-center justify-between rounded-lg border p-4"><div><div className="font-medium">{model.name}</div><div className="text-xs text-muted-foreground">{providers.find(p => p.id === model.providerConnectionId)?.name} · {model.enabled ? ui('Enabled') : ui('Disabled')}</div></div><div className="flex gap-2"><Button variant="outline" onClick={() => open(model)}>{ui('Edit')}</Button><Button variant="ghost" onClick={() => { if (confirm(ui('Delete this speech model?'))) void apiRequest(`/api/admin/speech-models/${model.id}`, { method: 'DELETE' }).then(load).catch(error => setError(error.message)) }}>{ui('Delete')}</Button></div></div>)}
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !saving) setDraft(null) }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{ui(editing ? 'Edit speech model' : 'Add speech model')}</DialogTitle></DialogHeader>{draft && <div className="space-y-4">
      {text('id', 'ID')}{text('name', 'Display name')}
      <label className="block text-sm">{ui('Provider')}<select aria-label={ui('Provider')} className="mt-1 w-full rounded border bg-background p-2" value={draft.providerConnectionId} onChange={e => field('providerConnectionId', e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {text('upstreamModelId', 'Upstream model ID')}{toggle('enabled', 'Enabled')}{number('sortOrder', 'Sort order')}
      <label className="block text-sm">{ui('Voices: one ID | label per line')}<Textarea className="mt-1" rows={5} value={voices} onChange={e => setVoices(e.target.value)} /></label>
      {text('defaultVoice', 'Default voice ID')}{toggle('supportsInstructions', 'Supports instructions')}{toggle('supportsSpeed', 'Supports speed')}
      {draft.supportsSpeed && <div className="grid grid-cols-2 gap-3">{number('speedMin', 'Minimum speed')}{number('speedMax', 'Maximum speed')}</div>}
      <div className="grid grid-cols-2 gap-3">{number('maxInputCharacters', 'Maximum input characters')}{number('maxInputTokens', 'Token limit (blank for none)')}</div>
      <p className="text-xs text-muted-foreground">{ui('Token limits use a conservative UTF-8 byte bound, including instructions.')}</p>
      <label className="block text-sm">{ui('Audio format')}<select aria-label={ui('Audio format')} className="ml-2 rounded border bg-background p-2" value={draft.responseFormat} onChange={e => field('responseFormat', e.target.value)}><option value="mp3">{ui('MP3')}</option><option value="wav">{ui('WAV')}</option></select></label>
      {toggle('supportsSse', 'Supports OpenAI speech SSE events and usage')}{toggle('billUsers', 'Bill users for speech')}
      {draft.billUsers && <><label className="block text-sm">{ui('Billing unit')}<select aria-label={ui('Billing unit')} className="ml-2 rounded border bg-background p-2" value={draft.billingUnit} onChange={e => field('billingUnit', e.target.value)}><option value="tokens">{ui('Tokens')}</option><option value="characters">{ui('Characters')}</option><option value="duration">{ui('Audio duration')}</option></select></label>
        {draft.billingUnit === 'tokens' ? <>{number('inputPriceMicros', 'USD per 1M input text tokens', true)}{number('outputPriceMicros', 'USD per 1M output audio tokens', true)}</> : draft.billingUnit === 'characters' ? number('characterPriceMicros', 'USD per 1,000 characters', true) : number('minutePriceMicros', 'USD per audio minute', true)}
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={saving} onClick={() => void save()}>{ui(saving ? 'Saving…' : 'Save')}</Button>
    </div>}</DialogContent></Dialog>
  </div>
}
