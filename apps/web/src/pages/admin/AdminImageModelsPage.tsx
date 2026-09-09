import { useEffect, useState } from 'react'
import { AZURE_MAI_IMAGE_PRESET, META_MUSE_IMAGE_PRESET, imageModelSchema, imagePriceLabel, type ImageModel } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'

export function AdminImageModelsPage() {
  const [models, setModels] = useState<ImageModel[]>([])
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])
  const [draft, setDraft] = useState<ImageModel | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    const [catalog, connections] = await Promise.all([apiRequest<{ data: ImageModel[] }>('/api/admin/image-models'), apiRequest<{ data: typeof providers }>('/api/admin/providers')])
    setModels(catalog.data); setProviders(connections.data)
  }
  useEffect(() => { void load().catch(error => setError(error.message)) }, [])
  const open = (model?: ImageModel) => { setDraft(model ?? { ...AZURE_MAI_IMAGE_PRESET, id: '', providerConnectionId: providers[0]?.id ?? '' }); setEditing(Boolean(model)); setError('') }
  const field = <K extends keyof ImageModel>(key: K, value: ImageModel[K]) => setDraft(current => current ? { ...current, [key]: value } : current)
  const text = (key: 'id' | 'name' | 'upstreamModelId', label: string) => <label className="block text-sm">{ui(label)}<Input className="mt-1" disabled={saving || (key === 'id' && editing)} value={draft?.[key] ?? ''} onChange={event => field(key, event.target.value)} /></label>
  const save = async () => {
    const parsed = imageModelSchema.safeParse(draft)
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')); return }
    setSaving(true); setError('')
    try {
      await apiRequest(editing ? `/api/admin/image-models/${parsed.data.id}` : '/api/admin/image-models', { method: editing ? 'PATCH' : 'POST', body: parsed.data })
      await load(); setDraft(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save image model') }
    finally { setSaving(false) }
  }
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{ui('Image models')}</h1><Button onClick={() => open()}>{ui('Add image model')}</Button></div>
    <p className="text-sm text-muted-foreground">{ui('Configure image generation using your provider connections. Users choose a model and enable image generation in Settings.')}</p>
    {error && !draft && <p role="alert" className="text-sm text-destructive">{ui(error)}</p>}
    {models.map(model => <div key={model.id} className="flex items-center justify-between gap-3 rounded-lg border p-4"><div className="min-w-0"><div className="font-medium">{model.name}</div><div className="text-xs text-muted-foreground">{providers.find(provider => provider.id === model.providerConnectionId)?.name} · {ui(model.enabled ? 'Enabled' : 'Disabled')} · {ui(imagePriceLabel(model))}</div></div><div className="flex gap-2"><Button variant="outline" onClick={() => open(model)}>{ui('Edit')}</Button><Button variant="ghost" onClick={() => { if (confirm(ui('Delete this image model?'))) void apiRequest(`/api/admin/image-models/${model.id}`, { method: 'DELETE' }).then(load).catch(error => setError(error.message)) }}>{ui('Delete')}</Button></div></div>)}
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !saving) setDraft(null) }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{ui(editing ? 'Edit image model' : 'Add image model')}</DialogTitle></DialogHeader>{draft && <div className="space-y-4">
      <label className="block text-sm">{ui('Image provider API')}<select aria-label={ui('Image provider API')} disabled={saving} className="mt-1 w-full rounded border bg-background p-2" value={draft.adapter} onChange={event => {
        const preset = event.target.value === 'meta-muse' ? META_MUSE_IMAGE_PRESET : AZURE_MAI_IMAGE_PRESET
        setDraft(current => current ? { ...current, adapter: preset.adapter, name: preset.name, upstreamModelId: preset.upstreamModelId, enabled: false } : current)
      }}><option value="azure-mai">{ui('Azure MAI')}</option><option value="meta-muse">{ui('Meta Muse')}</option></select></label>
      {text('id', 'ID')}{text('name', 'Display name')}
      <label className="block text-sm">{ui('Provider')}<select aria-label={ui('Provider')} disabled={saving} className="mt-1 w-full rounded border bg-background p-2" value={draft.providerConnectionId} onChange={event => field('providerConnectionId', event.target.value)}><option value="" disabled>{ui('Choose a provider')}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">{ui(draft.adapter === 'azure-mai' ? 'Use your Foundry resource endpoint and API key. Enter the deployment name below.' : 'Use https://api.meta.ai/v1 and a Meta Model API key.')}</p>
      {text('upstreamModelId', draft.adapter === 'azure-mai' ? 'Deployment name' : 'Upstream model ID')}
      <label className="block text-sm">{ui('Sort order')}<Input type="number" min={0} step={1} disabled={saving} value={draft.sortOrder} onChange={event => field('sortOrder', Number(event.target.value))} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={saving} checked={draft.enabled} onChange={event => field('enabled', event.target.checked)} />{ui('Enabled')}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={saving} checked={draft.billUsers} onChange={event => field('billUsers', event.target.checked)} />{ui('Bill users for images')}</label>
      {draft.billUsers && <label className="block text-sm">{ui('USD per generated image')}<Input type="number" min={0} step="0.000001" disabled={saving} value={draft.imagePriceMicros / 1e6} onChange={event => field('imagePriceMicros', Math.round(Number(event.target.value) * 1e6))} /></label>}
      {error && <p role="alert" className="whitespace-pre-line text-sm text-destructive">{ui(error)}</p>}<Button disabled={saving} onClick={() => void save()}>{ui(saving ? 'Saving…' : 'Save')}</Button>
    </div>}</DialogContent></Dialog>
  </div>
}
