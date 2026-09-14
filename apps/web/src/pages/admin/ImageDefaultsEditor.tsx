import { useEffect, useState } from 'react'
import type { ImageCatalog, ImageDefaults, ImageModel } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

export function ImageDefaultsEditor({ models }: { models: ImageModel[] }) {
  const [catalog, setCatalog] = useState<ImageCatalog>()
  const [saved, setSaved] = useState<ImageDefaults>()
  const [modelId, setModelId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void Promise.all([
      apiRequest<ImageDefaults>('/api/admin/settings/image'),
      apiRequest<ImageCatalog>('/api/image-models'),
    ]).then(([defaults, available]) => {
      if (active) { setSaved(defaults); setModelId(defaults.modelId); setCatalog(available); setError('') }
    }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [models])
  const selected = catalog?.data.find(model => model.id === modelId)
  const save = async () => {
    setSaving(true); setError('')
    try {
      const defaults = await apiRequest<ImageDefaults>('/api/admin/settings/image', { method: 'PATCH', body: { modelId } })
      setSaved(defaults)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save image defaults') }
    finally { setSaving(false) }
  }
  return <div className="space-y-3 rounded-lg border p-4">
    <label className="block text-sm font-medium">{ui('Default image model')}
      <select className="mt-2 w-full rounded border bg-background p-2" value={modelId ?? ''} disabled={!saved || saving} onChange={event => setModelId(event.target.value || null)}>
        <option value="">{ui('No default')}</option>
        {modelId && !selected && <option value={modelId} disabled>{ui('Selected model unavailable')}</option>}
        {catalog?.data.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
    </label>
    <p className="text-sm text-muted-foreground">{ui('Used when a user has not chosen an image model. Users’ own model choices take precedence. Users must still enable image generation in Settings.')}</p>
    {modelId && catalog && !selected && <p className="text-sm text-destructive">{ui('The default model or its provider is unavailable. Choose an enabled model or clear the default.')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{ui(error)}</p>}
    <Button variant="outline" disabled={!saved || saving || saved.modelId === modelId || Boolean(modelId && !selected)} onClick={() => void save()}>{ui(saving ? 'Saving…' : 'Save default')}</Button>
  </div>
}
