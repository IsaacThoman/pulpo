import { useEffect, useState } from 'react'
import type { SpeechCatalog, SpeechDefaults, SpeechModelCatalogEntry } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

export function SpeechDefaultsEditor({ models }: { models: SpeechModelCatalogEntry[] }) {
  const [catalog, setCatalog] = useState<SpeechCatalog>()
  const [saved, setSaved] = useState<SpeechDefaults>()
  const [modelId, setModelId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void Promise.all([
      apiRequest<SpeechDefaults>('/api/admin/settings/speech'),
      apiRequest<SpeechCatalog>('/api/speech-models'),
    ]).then(([defaults, available]) => {
      if (active) { setSaved(defaults); setModelId(defaults.modelId); setCatalog(available); setError('') }
    }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [models])
  const selected = catalog?.data.find(model => model.id === modelId)
  const save = async () => {
    setSaving(true); setError('')
    try {
      const defaults = await apiRequest<SpeechDefaults>('/api/admin/settings/speech', { method: 'PATCH', body: { modelId } })
      setSaved(defaults)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save speech defaults') }
    finally { setSaving(false) }
  }
  return <div className="space-y-3 rounded-lg border p-4">
    <label className="block text-sm font-medium">{ui('Default speech model')}
      <select className="mt-2 w-full rounded border bg-background p-2" value={modelId ?? ''} disabled={!saved || saving} onChange={event => setModelId(event.target.value || null)}>
        <option value="">{ui('No default')}</option>
        {modelId && !selected && <option value={modelId} disabled>{ui('Selected model unavailable')}</option>}
        {catalog?.data.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
    </label>
    <p className="text-sm text-muted-foreground">{ui('Used when a user has not chosen a speech model. Set each model’s default voice in its voice editor; users’ own model and voice choices take precedence.')}</p>
    {selected && <p className="text-sm text-muted-foreground">{ui('Default voice: {{name}}', { name: selected.voices.find(voice => voice.id === selected.defaultVoice)?.label ?? selected.defaultVoice })}</p>}
    {modelId && catalog && !selected && <p className="text-sm text-destructive">{ui('The default model or its provider is unavailable. Choose an enabled model or clear the default.')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{ui(error)}</p>}
    <Button variant="outline" disabled={!saved || saving || saved.modelId === modelId || Boolean(modelId && !selected)} onClick={() => void save()}>{ui(saving ? 'Saving…' : 'Save default')}</Button>
  </div>
}
