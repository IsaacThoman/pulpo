import { useState, useSyncExternalStore } from 'react'
import { SPEECH_ASSET_MAX_BYTES, type SpeechModelCatalogEntry, type SpeechProviderVoice } from '@pulpo/contracts'
import { apiRequest, fetchApiBlob } from '@/lib/api'
import { browserSpeechAudio, speechPlayback } from '@/features/speech/playback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ui } from '@/i18n/ui'

type Voice = SpeechModelCatalogEntry['voices'][number]
const acceptedAudio = '.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus'
export function SpeechVoiceAssetsEditor({ model, voice, disabled, onSaved, onError }: { model: SpeechModelCatalogEntry; voice: Voice; disabled: boolean; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('Hello. This is a sample of my voice.')
  const base = `/api/admin/speech-models/${encodeURIComponent(model.id)}/voices/${encodeURIComponent(voice.id)}`
  const run = async (action: () => Promise<void>) => { setBusy(true); onError(''); try { await action() } catch (error) { onError(error instanceof Error ? ui(error.message) : ui('Voice operation failed')) } finally { setBusy(false) } }
  const upload = (kind: 'clone' | 'watermark', file?: File) => {
    if (!file) return
    void run(async () => {
      if (!file.size || file.size > SPEECH_ASSET_MAX_BYTES) throw new Error(ui('Choose a nonempty audio clip up to 10 MiB'))
      const body = new FormData(); body.append('file', file)
      await apiRequest(`${base}/${kind}`, { method: 'POST', body }); await onSaved()
    })
  }
  const preview = (path: string, init?: RequestInit) => run(async () => {
    await speechPlayback.start(`preview:asset:${voice.id}`, ['preview'], async (_, signal) => browserSpeechAudio(await fetchApiBlob(path, { ...init, signal })))
    if (speechPlayback.getSnapshot().error) throw new Error(speechPlayback.getSnapshot().error!)
  })
  return <div className="space-y-2"><fieldset disabled={disabled || busy} className="space-y-3 rounded-md border p-3">
    {disabled && <p className="text-xs text-muted-foreground">{ui('Save the model and voice before managing audio assets.')}</p>}
    {model.adapter === 'mistral' && <div className="space-y-2">
      <label className="block text-sm">{ui('Cloning reference')}<input className="mt-1 block w-full text-xs" aria-label={ui('Cloning reference for {{name}}', { name: voice.label })} type="file" accept={acceptedAudio} onChange={event => { upload('clone', event.target.files?.[0]); event.target.value = '' }} /></label>
      <p className="text-xs text-muted-foreground">{ui('Upload 3–30 seconds of reference audio, up to 10 MiB. The reference is private; it is sent to Mistral to create the voice.')}</p>
      {voice.referenceAvailable && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void preview(`${base}/clone`)}>{ui('Listen to reference')}</Button><Button size="sm" variant="outline" onClick={() => void run(async () => { await apiRequest(`${base}/clone/repair`, { method: 'POST' }); await onSaved() })}>{ui('Repair provider voice')}</Button></div>}
    </div>}
    <label className="block text-sm">{ui('Watermark clip')}<input className="mt-1 block w-full text-xs" aria-label={ui('Watermark clip for {{name}}', { name: voice.label })} type="file" accept={acceptedAudio} onChange={event => { upload('watermark', event.target.files?.[0]); event.target.value = '' }} /></label>
    <p className="text-xs text-muted-foreground">{ui('Audio up to 2 minutes and 10 MiB. When enabled, this clip loops beneath speech and user previews.')}</p>
    {voice.watermarkAvailable && <>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => void preview(`${base}/watermark`)}>{ui('Listen to watermark')}</Button><Button size="sm" variant="ghost" onClick={() => void run(async () => { await apiRequest(`${base}/watermark`, { method: 'DELETE' }); await onSaved() })}>{ui('Remove watermark')}</Button></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={voice.watermark?.enabled ?? false} onChange={event => void run(async () => { await apiRequest(`${base}/watermark`, { method: 'PATCH', body: { enabled: event.target.checked, volume: voice.watermark?.volume ?? 0.15 } }); await onSaved() })} />{ui('Enable watermark')}</label>
      <label className="block text-sm">{ui('Watermark volume (%)')}<Input type="number" min={1} max={100} defaultValue={Math.round((voice.watermark?.volume ?? 0.15) * 100)} key={voice.watermark?.volume} onBlur={event => {
        const volume = Number(event.target.value) / 100
        if (volume === (voice.watermark?.volume ?? 0.15)) return
        void run(async () => { if (volume < 0.01 || volume > 1) throw new Error(ui('Use a watermark volume from 1 to 100%.')); await apiRequest(`${base}/watermark`, { method: 'PATCH', body: { enabled: voice.watermark?.enabled ?? false, volume } }); await onSaved() })
      }} /></label>
    </>}
    <label className="block text-sm">{ui('Test speech')}<Input value={text} maxLength={500} onChange={event => setText(event.target.value)} /></label>
    <p className="text-xs text-muted-foreground">{ui('Tests use the provider API and may incur provider costs. They do not charge a user balance.')}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => void preview(`${base}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: text }) })}>{ui('Test voice and watermark')}</Button>
      <Button size="sm" variant="outline" onClick={() => void run(async () => { await fetchApiBlob(`${base}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: text, savePreview: true }) }); await onSaved() })}>{ui('Generate user preview')}</Button>
    </div>
  </fieldset>{playback.key === `preview:asset:${voice.id}` && <Button size="sm" variant="outline" onClick={() => speechPlayback.stop()}>{ui('Stop preview')}</Button>}</div>
}

export function MistralVoiceDiscovery({ modelId, voices, disabled, onImport, onError }: { modelId: string; voices: Voice[]; disabled: boolean; onImport: (voices: Voice[]) => void; onError: (message: string) => void }) {
  const [catalog, setCatalog] = useState<SpeechProviderVoice[]>([])
  const [busy, setBusy] = useState(false)
  const base = `/api/admin/speech-models/${encodeURIComponent(modelId)}/provider-voices`
  return <div className="space-y-2">
    {disabled && <p className="text-xs text-muted-foreground">{ui('Save this disabled model first, then discover voices or add a named voice and upload its cloning reference.')}</p>}
    <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => { setBusy(true); void apiRequest<{ data: SpeechProviderVoice[] }>(base).then(result => setCatalog(result.data)).catch(error => onError(ui(error.message))).finally(() => setBusy(false)) }}>{ui('Load Mistral voices')}</Button>
    {catalog.length > 0 && <div className="max-h-56 overflow-y-auto rounded-md border p-2">{catalog.map(voice => <div key={voice.id} className="flex items-center justify-between gap-2 py-1 text-sm"><span className="min-w-0 break-words">{voice.name} {voice.languages.join(', ')}</span><div className="flex shrink-0 gap-1">
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void speechPlayback.start(`preview:provider:${voice.id}`, ['sample'], async (_, signal) => browserSpeechAudio(await fetchApiBlob(`${base}/${encodeURIComponent(voice.id)}/sample`, { signal })))}>{ui('Preview')}</Button>
      <Button size="sm" variant="outline" disabled={disabled || voices.length >= 200 || voices.some(v => v.id === voice.id)} onClick={() => onImport([...voices, { id: voice.id, label: voice.name.slice(0, 120), kind: 'provider' }])}>{ui('Add voice')}</Button>
    </div></div>)}</div>}
  </div>
}
