import { useEffect, useState, useSyncExternalStore } from 'react'
import { OPENAI_SPEECH_PRESET, VOXTRAL_SPEECH_PRESET, speechModelSchema, type SpeechModel, type SpeechModelCatalogEntry } from '@pulpo/contracts'
import { speechPlayback } from '@/features/speech/playback'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpeechVoicePreview } from './SpeechVoicePreview'
import { MistralVoiceDiscovery, SpeechVoiceAssetsEditor } from './SpeechVoiceAssetsEditor'
import { SpeechDefaultsEditor } from './SpeechDefaultsEditor'
import { SpeechVoiceEditor } from './SpeechVoiceEditor'
import { speechVoiceIssues } from './speech-voice-validation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'

const fieldLabels: Partial<Record<keyof SpeechModel, string>> = {
  id: 'ID', providerConnectionId: 'Provider', name: 'Display name', upstreamModelId: 'Upstream model ID',
  sortOrder: 'Sort order', speedMin: 'Minimum speed', speedMax: 'Maximum speed',
  maxInputCharacters: 'Maximum input characters', maxInputTokens: 'Token limit',
  inputPriceMicros: 'Input token price', outputPriceMicros: 'Output audio token price',
  characterPriceMicros: 'Character price', minutePriceMicros: 'Audio minute price',
  supportsSse: 'Supports OpenAI speech SSE events and usage', defaultVoice: 'Default voice ID', voices: 'Voices',
}

export function AdminSpeechModelsPage() {
  const [cleanupJobs, setCleanupJobs] = useState<Array<{ id: string; readyAt: string; error: string | null }>>([])
  const [models, setModels] = useState<SpeechModelCatalogEntry[]>([])
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])
  const [draft, setDraft] = useState<SpeechModelCatalogEntry | null>(null)
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const [previewChanges, setPreviewChanges] = useState<Record<string, File | null>>({})
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const load = async () => {
    const [catalog, connections, cleanup] = await Promise.all([apiRequest<{ data: SpeechModelCatalogEntry[] }>('/api/admin/speech-models'), apiRequest<{ data: Array<{ id: string; name: string }> }>('/api/admin/providers'), apiRequest<{ data: Array<{ id: string; readyAt: string; error: string | null }> }>('/api/admin/speech-models/cleanup')])
    setModels(catalog.data); setProviders(connections.data); setCleanupJobs(cleanup.data)
  }
  useEffect(() => { void load().catch(error => setError(error.message)) }, [])
  const open = (model?: SpeechModelCatalogEntry) => {
    const next = model ?? { ...OPENAI_SPEECH_PRESET, id: '', providerConnectionId: providers[0]?.id ?? '' }
    speechPlayback.stop(); setPreviewChanges({})
    setDraft(next); setEditing(Boolean(model)); setError('')
  }
  const field = (key: keyof SpeechModel, value: unknown) => setDraft(current => current ? { ...current, [key]: value } : current)
  const text = (key: 'id' | 'name' | 'upstreamModelId', label: string) => <label className="block text-sm">{ui(label)}<Input className="mt-1" disabled={key === 'id' && editing} value={draft?.[key] ?? ''} onChange={e => field(key, e.target.value)} /></label>
  const number = (key: keyof SpeechModel, label: string, price = false) => {
    const limit = key === 'maxInputCharacters' || key === 'maxInputTokens'
    return <label className="block text-sm">{ui(label)}<Input className="mt-1" type="number" min={limit ? 1 : 0} step={price ? '0.000001' : limit || key === 'sortOrder' ? 1 : 'any'} value={draft?.[key] === null ? '' : Number(draft?.[key] ?? 0) / (price ? 1e6 : 1)} onChange={e => field(key, e.target.value === '' && key === 'maxInputTokens' ? null : price ? Math.round(Number(e.target.value) * 1e6 * 100) / 100 : Number(e.target.value))} /></label>
  }
  const toggle = (key: keyof SpeechModel, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft?.[key])} onChange={e => field(key, e.target.checked)} />{ui(label)}</label>
  const save = async () => {
    if (!draft || speechVoiceIssues(draft).invalid) return
    setSaving(true); setError('')
    try {
      const parsed = speechModelSchema.safeParse(draft)
      if (!parsed.success) {
        setError(parsed.error.issues.map(issue => {
          const key = issue.path[0] as keyof SpeechModel
          const label = fieldLabels[key] ?? String(key ?? 'Speech model')
          const message = key === 'maxInputCharacters' || key === 'maxInputTokens' ? 'Enter a positive whole number.' : issue.message
          return `${ui(label)}: ${ui(message)}`
        }).join('\n'))
        return
      }
      const model = parsed.data
      await apiRequest(editing ? `/api/admin/speech-models/${model.id}` : '/api/admin/speech-models', { method: editing ? 'PATCH' : 'POST', body: model })
      setEditing(true)
      for (const voice of model.voices) {
        const change = previewChanges[voice.id]
        const path = `/api/admin/speech-models/${model.id}/voices/${encodeURIComponent(voice.id)}/preview`
        if (change) {
          const body = new FormData(); body.append('file', change)
          await apiRequest(path, { method: 'POST', body })
        } else if (change === null) await apiRequest(path, { method: 'DELETE' })
      }
      await load(); speechPlayback.stop(); setDraft(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save speech model') }
    finally { setSaving(false) }
  }
  const persisted = models.find(model => model.id === draft?.id)
  const assetsDisabled = !editing || saving || Object.keys(previewChanges).length > 0 || !persisted || JSON.stringify(speechModelSchema.safeParse(draft).data) !== JSON.stringify(speechModelSchema.safeParse(persisted).data)
  const discoveryDisabled = !editing || saving || !persisted || persisted.providerConnectionId !== draft?.providerConnectionId || persisted.adapter !== draft?.adapter
  const reloadDraft = async () => {
    const catalog = await apiRequest<{ data: SpeechModelCatalogEntry[] }>('/api/admin/speech-models')
    setModels(catalog.data); setDraft(current => catalog.data.find(model => model.id === current?.id) ?? null)
    const cleanup = await apiRequest<{ data: typeof cleanupJobs }>('/api/admin/speech-models/cleanup'); setCleanupJobs(cleanup.data)
  }
  return <div className="space-y-5"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{ui('Speech models')}</h1><Button onClick={() => open()}>{ui('Add speech model')}</Button></div>
    <p className="text-sm text-muted-foreground">{ui('Configure voices and playback models using your provider connections. New entries start with editable OpenAI defaults and are disabled until enabled.')}</p>
    {error && <p role="alert" className="whitespace-pre-line text-sm text-destructive">{ui(error)}</p>}
    <SpeechDefaultsEditor models={models} />
    {cleanupJobs.length > 0 && <details className="rounded-md border p-3"><summary>{ui('Speech resource cleanup')}</summary>{cleanupJobs.map(job => <div key={job.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span>{ui(job.error ?? 'Staged audio upload; cleanup becomes available after ten minutes.')}</span><Button variant="outline" size="sm" disabled={new Date(job.readyAt) > new Date()} onClick={() => void apiRequest(`/api/admin/speech-models/cleanup/${job.id}/retry`, { method: 'POST' }).then(load).catch(error => setError(error.message))}>{ui('Retry cleanup')}</Button></div>)}</details>}
    {models.map(model => <div key={model.id} className="flex items-center justify-between rounded-lg border p-4"><div><div className="font-medium">{model.name}</div><div className="text-xs text-muted-foreground">{providers.find(p => p.id === model.providerConnectionId)?.name} · {model.enabled ? ui('Enabled') : ui('Disabled')}</div></div><div className="flex gap-2"><Button variant="outline" onClick={() => open(model)}>{ui('Edit')}</Button><Button variant="ghost" onClick={() => { if (confirm(ui('Delete this speech model?'))) void apiRequest(`/api/admin/speech-models/${model.id}`, { method: 'DELETE' }).then(load).catch(error => setError(error.message)) }}>{ui('Delete')}</Button></div></div>)}
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !saving) { speechPlayback.stop(); setDraft(null) } }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{ui(editing ? 'Edit speech model' : 'Add speech model')}</DialogTitle></DialogHeader>{draft && <div className="space-y-4">
      {text('id', 'ID')}{text('name', 'Display name')}
      <label className="block text-sm">{ui('Provider')}<select aria-label={ui('Provider')} className="mt-1 w-full rounded border bg-background p-2" value={draft.providerConnectionId} onChange={e => field('providerConnectionId', e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block text-sm">{ui('Speech adapter')}<select aria-label={ui('Speech adapter')} className="mt-1 w-full rounded border bg-background p-2" value={draft.adapter ?? 'openai'} onChange={event => {
        const adapter = event.target.value as 'openai' | 'mistral'
        const preset = adapter === 'mistral' ? VOXTRAL_SPEECH_PRESET : OPENAI_SPEECH_PRESET
        setDraft(current => current ? { ...preset, id: current.id, providerConnectionId: current.providerConnectionId, ...(editing ? { name: current.name, voices: current.voices, defaultVoice: current.defaultVoice } : {}) } : current)
      }}><option value="openai">{ui('OpenAI compatible')}</option><option value="mistral">{ui('Mistral Voxtral')}</option></select></label>
      {draft.adapter === 'mistral' && <MistralVoiceDiscovery modelId={draft.id} voices={draft.voices} disabled={discoveryDisabled} onError={setError} onImport={voices => setDraft(current => current ? { ...current, voices, defaultVoice: current.defaultVoice || voices[0]?.id || '' } : current)} />}
      {text('upstreamModelId', 'Upstream model ID')}{toggle('enabled', 'Enabled')}{number('sortOrder', 'Sort order')}
      <SpeechVoiceEditor mistral={draft.adapter === 'mistral'} value={draft} onChange={value => {
        speechPlayback.stop()
        setDraft(current => current ? { ...current, ...value, voices: value.voices.map(voice => ({ ...voice,
          previewAvailable: models.find(model => model.id === current.id)?.voices.some(saved => saved.id === voice.id && saved.previewAvailable) ?? false,
        })) } : current)
      }} renderPreview={index => {
        const voice = draft.voices[index]!
        return <div className="space-y-3"><SpeechVoicePreview modelId={draft.id} voiceId={voice.id.trim()} label={voice.label || voice.id} available={Boolean(voice.previewAvailable)} change={previewChanges[voice.id.trim()]} disabled={saving || Boolean(speechVoiceIssues(draft).rows[index]?.id)} onChange={change => setPreviewChanges(current => ({ ...current, [voice.id.trim()]: change }))} onError={setError} /><details><summary className="cursor-pointer text-sm">{ui('Voice audio settings')}</summary><SpeechVoiceAssetsEditor model={draft} voice={voice} disabled={assetsDisabled} onSaved={reloadDraft} onError={setError} /></details></div>
      }} />
      {playback.error && <p role="alert" className="text-sm text-destructive">{ui(playback.error)}</p>}
      {draft.adapter !== 'mistral' && <>{toggle('supportsInstructions', 'Supports instructions')}{toggle('supportsSpeed', 'Supports speed')}</>}
      {draft.supportsSpeed && <div className="grid grid-cols-2 gap-3">{number('speedMin', 'Minimum speed')}{number('speedMax', 'Maximum speed')}</div>}
      <div className="grid grid-cols-2 gap-3">{number('maxInputCharacters', 'Maximum input characters')}{number('maxInputTokens', 'Token limit (blank for none)')}</div>
      <p className="text-xs text-muted-foreground">{ui('Use the limits supported by your provider. Longer messages are split automatically to fit the model and request size limits.')}</p>
      <p className="text-xs text-muted-foreground">{ui('Token limits use a conservative UTF-8 byte bound, including instructions.')}</p>
      <label className="block text-sm">{ui('Audio format')}<select aria-label={ui('Audio format')} className="ml-2 rounded border bg-background p-2" value={draft.responseFormat} onChange={e => field('responseFormat', e.target.value)}><option value="mp3">{ui('MP3')}</option><option value="wav">{ui('WAV')}</option></select></label>
      {draft.adapter !== 'mistral' && toggle('supportsSse', 'Supports OpenAI speech SSE events and usage')}{toggle('billUsers', 'Bill users for speech')}
      {draft.billUsers && <><label className="block text-sm">{ui('Billing unit')}<select aria-label={ui('Billing unit')} className="ml-2 rounded border bg-background p-2" value={draft.billingUnit} onChange={e => field('billingUnit', e.target.value)}>{draft.adapter !== 'mistral' && <option value="tokens">{ui('Tokens')}</option>}<option value="characters">{ui('Characters')}</option><option value="duration">{ui('Audio duration')}</option></select></label>
        {draft.billingUnit === 'tokens' ? <>{number('inputPriceMicros', 'USD per 1M input text tokens', true)}{number('outputPriceMicros', 'USD per 1M output audio tokens', true)}</> : draft.billingUnit === 'characters' ? number('characterPriceMicros', 'USD per 1,000 characters', true) : number('minutePriceMicros', 'USD per audio minute', true)}
      </>}
      {error && <p role="alert" className="whitespace-pre-line text-sm text-destructive">{ui(error)}</p>}<Button disabled={saving || speechVoiceIssues(draft).invalid} onClick={() => void save()}>{ui(saving ? 'Saving…' : 'Save')}</Button>
    </div>}</DialogContent></Dialog>
  </div>
}
