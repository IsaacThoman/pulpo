import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Square } from 'lucide-react'
import type { EpisodicMemoryAdminStatus, EpisodicMemoryProfile, EpisodicMemoryRecallMode } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { SaveBar, Section, Toggle } from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { ui, uit } from '@/i18n/ui'

function bytes(value: number): string {
  if (!value) return '0 MB'
  return `${(value / 1_000_000).toFixed(value >= 1_000_000_000 ? 1 : 0)} MB`
}

function generationStatusLabel(status: 'pending' | 'pulling' | 'indexing' | 'ready' | 'failed' | 'cancelled'): string {
  if (status === 'pending') return ui('Pending')
  if (status === 'pulling') return ui('Downloading model')
  if (status === 'indexing') return ui('Indexing')
  if (status === 'ready') return ui('Ready')
  if (status === 'failed') return ui('Failed')
  return ui('Cancelled')
}

export function EpisodicMemorySection() {
  const [status, setStatus] = useState<EpisodicMemoryAdminStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setStatus(await apiRequest<EpisodicMemoryAdminStatus>('/api/admin/settings/episodic-memory')), [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!status?.buildingGeneration) return
    const interval = window.setInterval(() => void load(), 2_000)
    return () => window.clearInterval(interval)
  }, [load, status?.buildingGeneration])
  if (!status) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{ui('Loading episodic memory status…')}</div>

  const selected = status.profiles.find((profile) => profile.id === status.settings.profile) ?? status.profiles[0]!
  const installed = status.ollama.installedModels.find((model) => model.name === selected.model)
  const generation = status.buildingGeneration ?? status.activeGeneration
  const save = async () => {
    setBusy(true)
    try {
      setStatus(await apiRequest<EpisodicMemoryAdminStatus>('/api/admin/settings/episodic-memory', {
        method: 'PATCH', body: status.settings,
      }))
    } finally { setBusy(false) }
  }
  const action = async (path: 'rebuild' | 'cancel') => {
    setBusy(true)
    try {
      await apiRequest(`/api/admin/settings/episodic-memory/${path}`, { method: 'POST' })
      await load()
    } finally { setBusy(false) }
  }

  return <div>
    <Section title={ui('Episodic memory')} hint={ui("Generate embeddings locally and recall relevant material from a user's previous chats when their Memories setting is enabled.")}>
      <Toggle
        label={ui('Enable relevant-chat recall')}
        hint={ui('Enabling downloads the selected model and backfills eligible chats for users who opted into Memories. Disabling pauses indexing and recall without deleting the active index.')}
        checked={status.settings.enabled}
        onChange={(enabled) => setStatus({ ...status, settings: { ...status.settings, enabled } })}
      />
      <label className="flex items-start justify-between gap-6 text-sm">
        <span><span className="block">{ui('Embedding model')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{ui('Curated local models only. A model change builds a parallel index before switching.')}</span></span>
        <select
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
          value={status.settings.profile}
          onChange={(event) => setStatus({ ...status, settings: { ...status.settings, profile: event.target.value as EpisodicMemoryProfile } })}
        >
          {status.profiles.map((profile) => <option key={profile.id} value={profile.id}>{uit`${profile.label} · ${profile.dimension}d · ~${bytes(profile.approximateSizeBytes)}`}</option>)}
        </select>
      </label>
      <label className="flex items-start justify-between gap-6 text-sm">
        <span><span className="block">{ui('Automatic recall mode')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{ui('Balanced is the default; conservative abstains more often and eager recalls more broadly.')}</span></span>
        <select
          className="h-9 w-48 rounded-md border bg-background px-3 text-sm capitalize"
          value={status.settings.recallMode}
          onChange={(event) => setStatus({ ...status, settings: { ...status.settings, recallMode: event.target.value as EpisodicMemoryRecallMode } })}
        >
          {(['conservative', 'balanced', 'eager'] as const).map((mode) => <option key={mode} value={mode}>{ui(mode[0]!.toUpperCase() + mode.slice(1))}</option>)}
        </select>
      </label>
    </Section>

    <Section title={ui('Local runtime')} hint={uit`Pulpo connects to ${selected.model} through the deployment's PULPO_OLLAMA_URL.`}>
      <div className="flex items-center gap-2 text-sm">
        {status.ollama.healthy ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-amber-600" />}
        <span>{status.ollama.healthy
          ? status.ollama.version ? uit`Ollama ${status.ollama.version} is healthy` : ui('Ollama is healthy')
          : status.ollama.error ?? ui('Ollama is unavailable')}</span>
      </div>
      <div className="text-sm">{installed
        ? uit`${selected.label} installed · ${installed.digest.slice(0, 19)}… · ${bytes(installed.size)}`
        : uit`${selected.label} is not installed yet`}</div>
    </Section>

    <Section title={ui('Index status')} hint={ui('Download and backfill run on a dedicated queue and never consume response-generation concurrency.')}>
      {!generation && <div className="text-sm text-muted-foreground">{ui('No index has been built.')}</div>}
      {generation && <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span>{generationStatusLabel(generation.status)}</span><span>{uit`${generation.profile} · ${generation.dimension} dimensions`}</span></div>
        {generation.status === 'pulling' && <div>{bytes(generation.downloadCompletedBytes)} / {bytes(generation.downloadTotalBytes || selected.approximateSizeBytes)}</div>}
        {generation.status === 'indexing' && <div>{uit`${generation.completedItems} / ${generation.totalItems} items · ${generation.failedItems} failed`}</div>}
        {generation.error && <div className="text-destructive">{generation.error}</div>}
      </div>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy || !status.settings.enabled} onClick={() => void action('rebuild')}><RotateCcw />{ui('Rebuild index')}</Button>
        <Button type="button" variant="outline" disabled={busy || !status.buildingGeneration} onClick={() => void action('cancel')}><Square />{ui('Cancel build')}</Button>
      </div>
    </Section>
    <SaveBar onSave={busy ? undefined : save} />
  </div>
}
