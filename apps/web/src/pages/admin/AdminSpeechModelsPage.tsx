import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Loader2, Play, Square, Trash2 } from 'lucide-react'
import { OPENAI_SPEECH_PRESET, speechModelSchema, type SpeechModel, type SpeechModelCatalogEntry } from '@pulpo/contracts'
import { previewSpeechFile, previewSpeechModel, speechPlayback } from '@/features/speech/playback'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpeechVoiceEditor } from './SpeechVoiceEditor'
import { speechVoiceIssues } from './speech-voice-validation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'

export function AdminSpeechModelsPage() {
  const [models, setModels] = useState<SpeechModelCatalogEntry[]>([])
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])
  const [draft, setDraft] = useState<SpeechModelCatalogEntry | null>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const previewInput = useRef<HTMLInputElement>(null)
  const [removePreview, setRemovePreview] = useState(false)
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const previewing = Boolean(playback.key?.startsWith('preview:'))
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const load = async () => {
    const [catalog, connections] = await Promise.all([apiRequest<{ data: SpeechModelCatalogEntry[] }>('/api/admin/speech-models'), apiRequest<{ data: Array<{ id: string; name: string }> }>('/api/admin/providers')])
    setModels(catalog.data); setProviders(connections.data)
  }
  useEffect(() => { void load().catch(error => setError(error.message)) }, [])
  const open = (model?: SpeechModelCatalogEntry) => {
    const next = model ?? { ...OPENAI_SPEECH_PRESET, id: '', providerConnectionId: providers[0]?.id ?? '' }
    speechPlayback.stop(); setPreviewFile(null); setRemovePreview(false)
    setDraft(next); setEditing(Boolean(model)); setError('')
  }
  const field = (key: keyof SpeechModel, value: unknown) => setDraft(current => current ? { ...current, [key]: value } : current)
  const text = (key: 'id' | 'name' | 'upstreamModelId', label: string) => <label className="block text-sm">{ui(label)}<Input className="mt-1" disabled={key === 'id' && editing} value={draft?.[key] ?? ''} onChange={e => field(key, e.target.value)} /></label>
  const number = (key: keyof SpeechModel, label: string, price = false) => <label className="block text-sm">{ui(label)}<Input className="mt-1" type="number" min={0} step={price ? '0.000001' : 'any'} value={draft?.[key] === null ? '' : Number(draft?.[key] ?? 0) / (price ? 1e6 : 1)} onChange={e => field(key, e.target.value === '' && key === 'maxInputTokens' ? null : Math.round(Number(e.target.value) * (price ? 1e6 : 1) * 100) / 100)} /></label>
  const toggle = (key: keyof SpeechModel, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft?.[key])} onChange={e => field(key, e.target.checked)} />{ui(label)}</label>
  const save = async () => {
    if (!draft || speechVoiceIssues(draft).invalid) return
    setSaving(true); setError('')
    try {
      const model = speechModelSchema.parse(draft)
      await apiRequest(editing ? `/api/admin/speech-models/${model.id}` : '/api/admin/speech-models', { method: editing ? 'PATCH' : 'POST', body: model })
      setEditing(true)
      if (previewFile) {
        const body = new FormData(); body.append('file', previewFile)
        await apiRequest(`/api/admin/speech-models/${model.id}/preview`, { method: 'POST', body })
      } else if (removePreview) await apiRequest(`/api/admin/speech-models/${model.id}/preview`, { method: 'DELETE' })
      await load(); speechPlayback.stop(); setDraft(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save speech model') }
    finally { setSaving(false) }
  }
  return <div className="space-y-5"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{ui('Speech models')}</h1><Button onClick={() => open()}>{ui('Add speech model')}</Button></div>
    <p className="text-sm text-muted-foreground">{ui('Configure voices and playback models using your provider connections. New entries start with editable OpenAI defaults and are disabled until enabled.')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {models.map(model => <div key={model.id} className="flex items-center justify-between rounded-lg border p-4"><div><div className="font-medium">{model.name}</div><div className="text-xs text-muted-foreground">{providers.find(p => p.id === model.providerConnectionId)?.name} · {model.enabled ? ui('Enabled') : ui('Disabled')}</div></div><div className="flex gap-2"><Button variant="outline" onClick={() => open(model)}>{ui('Edit')}</Button><Button variant="ghost" onClick={() => { if (confirm(ui('Delete this speech model?'))) void apiRequest(`/api/admin/speech-models/${model.id}`, { method: 'DELETE' }).then(load).catch(error => setError(error.message)) }}>{ui('Delete')}</Button></div></div>)}
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !saving) { speechPlayback.stop(); setDraft(null) } }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{ui(editing ? 'Edit speech model' : 'Add speech model')}</DialogTitle></DialogHeader>{draft && <div className="space-y-4">
      {text('id', 'ID')}{text('name', 'Display name')}
      <label className="block text-sm">{ui('Provider')}<select aria-label={ui('Provider')} className="mt-1 w-full rounded border bg-background p-2" value={draft.providerConnectionId} onChange={e => field('providerConnectionId', e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {text('upstreamModelId', 'Upstream model ID')}{toggle('enabled', 'Enabled')}{number('sortOrder', 'Sort order')}
      <SpeechVoiceEditor value={draft} onChange={value => setDraft(current => current ? { ...current, ...value } : current)} />
      <fieldset className="min-w-0 space-y-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{ui('Preview clip (optional)')}</legend>
        <p className="text-xs text-muted-foreground">{ui('Upload an MP3 or WAV sample, up to 30 seconds and 5 MiB. Users can play it for free before choosing this model.')}</p>
        <Button variant="outline" size="sm" disabled={saving} onClick={() => previewInput.current?.click()}>{ui(previewFile || (draft.previewAvailable && !removePreview) ? 'Replace preview' : 'Upload preview clip')}</Button>
        <input ref={previewInput} className="hidden" type="file" aria-label={ui('Upload preview clip')} accept="audio/mpeg,audio/wav,.mp3,.wav" disabled={saving} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (!file) return
          if (file.size > 5 * 1024 * 1024) { setError(ui('Preview clips may be at most 5 MiB')); return }
          speechPlayback.stop(); setPreviewFile(file); setRemovePreview(false); setError('')
        }} />
        {(previewFile || (draft.previewAvailable && !removePreview)) && <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">{previewFile?.name ?? ui('Preview clip uploaded')}</span>
          <Button variant="outline" size="sm" onClick={() => { if (previewing) speechPlayback.stop(); else if (previewFile) void previewSpeechFile(previewFile); else void previewSpeechModel(draft.id) }}>
            {previewing ? playback.phase === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" /> : <Play className="size-4" />}{ui(previewing ? 'Stop preview' : 'Play preview')}
          </Button>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => { speechPlayback.stop(); setPreviewFile(null); setRemovePreview(true) }}><Trash2 className="size-4" />{ui('Remove preview')}</Button>
        </div>}
        {removePreview && draft.previewAvailable && <p className="text-xs text-muted-foreground">{ui('The preview will be removed when you save.')}</p>}
        {playback.error && <p role="alert" className="text-sm text-destructive">{playback.error}</p>}
      </fieldset>
      {toggle('supportsInstructions', 'Supports instructions')}{toggle('supportsSpeed', 'Supports speed')}
      {draft.supportsSpeed && <div className="grid grid-cols-2 gap-3">{number('speedMin', 'Minimum speed')}{number('speedMax', 'Maximum speed')}</div>}
      <div className="grid grid-cols-2 gap-3">{number('maxInputCharacters', 'Maximum input characters')}{number('maxInputTokens', 'Token limit (blank for none)')}</div>
      <p className="text-xs text-muted-foreground">{ui('Token limits use a conservative UTF-8 byte bound, including instructions.')}</p>
      <label className="block text-sm">{ui('Audio format')}<select aria-label={ui('Audio format')} className="ml-2 rounded border bg-background p-2" value={draft.responseFormat} onChange={e => field('responseFormat', e.target.value)}><option value="mp3">{ui('MP3')}</option><option value="wav">{ui('WAV')}</option></select></label>
      {toggle('supportsSse', 'Supports OpenAI speech SSE events and usage')}{toggle('billUsers', 'Bill users for speech')}
      {draft.billUsers && <><label className="block text-sm">{ui('Billing unit')}<select aria-label={ui('Billing unit')} className="ml-2 rounded border bg-background p-2" value={draft.billingUnit} onChange={e => field('billingUnit', e.target.value)}><option value="tokens">{ui('Tokens')}</option><option value="characters">{ui('Characters')}</option><option value="duration">{ui('Audio duration')}</option></select></label>
        {draft.billingUnit === 'tokens' ? <>{number('inputPriceMicros', 'USD per 1M input text tokens', true)}{number('outputPriceMicros', 'USD per 1M output audio tokens', true)}</> : draft.billingUnit === 'characters' ? number('characterPriceMicros', 'USD per 1,000 characters', true) : number('minutePriceMicros', 'USD per audio minute', true)}
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={saving || speechVoiceIssues(draft).invalid} onClick={() => void save()}>{ui(saving ? 'Saving…' : 'Save')}</Button>
    </div>}</DialogContent></Dialog>
  </div>
}
