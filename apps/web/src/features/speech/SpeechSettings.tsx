import { useEffect, useSyncExternalStore } from 'react'
import { Check, Loader2, Play, Square } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQuery } from '@tanstack/react-query'
import { useSettings } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { speechCatalog, speechPlayback, previewSpeechVoice } from './playback'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

export function SpeechSettings() {
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [])
  const preferences = useSettings(s => s.speech)
  const set = useSettings(s => s.set)
  const userId = useAuth(s => s.user?.id)
  const catalog = useQuery({ queryKey: ['speech-models', userId], queryFn: speechCatalog })
  const model = catalog.data?.data.find(model => model.id === preferences.modelId)
  const settings = model ? preferences.models[model.id] ?? { instructions: '', speed: 1 } : undefined
  const update = (patch: object) => { if (model) set('speech', { ...preferences, models: { ...preferences.models, [model.id]: { ...settings!, ...patch } } }) }
  return <div className="space-y-5">
    <h3 className="text-lg font-semibold">{ui('Speech')}</h3>
    <p className="text-sm text-muted-foreground">{ui('Read messages aloud with an AI-generated voice.')}</p>
    {catalog.isError && <p role="alert">{ui('Speech models could not be loaded.')} <button onClick={() => void catalog.refetch()}>{ui('Retry')}</button></p>}
    <div className="space-y-2">
      <label id="speech-model-label" className="text-sm font-medium">{ui('Model')}</label>
      <Select value={preferences.modelId ?? ''} onValueChange={modelId => { speechPlayback.stop(); set('speech', { ...preferences, modelId }) }} disabled={catalog.isLoading}>
        <SelectTrigger aria-labelledby="speech-model-label" className="w-full"><SelectValue placeholder={ui(catalog.isLoading ? 'Loading…' : 'Choose a speech model')} /></SelectTrigger>
        <SelectContent>
          {preferences.modelId && !model && <SelectItem value={preferences.modelId} disabled>{ui('Selected model unavailable')}</SelectItem>}
          {catalog.data?.data.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    {catalog.data?.data.length === 0 && <p className="text-sm">{ui('An admin must configure a speech model first.')}</p>}
    {model && settings && <>
      <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium">{ui('Voice')}</legend>
        {settings.voice && !model.voices.some(v => v.id === settings.voice) && <p role="status" className="text-sm text-muted-foreground">{ui('Selected voice unavailable')}</p>}
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-1">
          {model.voices.map(voice => {
            const selected = (settings.voice ?? model.defaultVoice) === voice.id
            const active = playback.key === `preview:${model.id}:${voice.id}`
            return <div key={voice.id} className={cn('flex items-center gap-2 rounded-md px-3 transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring', selected && 'bg-muted')}>
              {/* Anchor the hidden radio to its row so focus scrolls the list, not the dialog. */}
              <label className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3">
                <input className="sr-only" type="radio" name="speech-voice" aria-label={voice.label} checked={selected} onChange={() => { speechPlayback.stop(); update({ voice: voice.id }) }} />
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{voice.label}</span>
                {selected && <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </label>
              {voice.previewAvailable && <Button variant="outline" size="icon" className="shrink-0 rounded-full" aria-label={active ? ui('Stop preview') : ui('Preview {{name}}', { name: voice.label })} aria-pressed={active} onClick={() => void previewSpeechVoice(model.id, voice.id)}>
                {active ? playback.phase === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5" /> : <Play className="size-4" />}
              </Button>}
            </div>
          })}
        </div>
        {playback.error && <p role="alert" className="text-sm text-destructive">{playback.error}</p>}
      </fieldset>
      {model.supportsInstructions && <label className="block text-sm">{ui('Instructions')}<Textarea className="mt-2" value={settings.instructions} maxLength={4096} placeholder={ui('Speak in a calm, friendly tone.')} onChange={event => update({ instructions: event.target.value })} /></label>}
      {model.supportsSpeed && <label className="block text-sm">{ui('Speed')}<Input className="mt-2" type="number" min={model.speedMin} max={model.speedMax} step="0.05" value={settings.speed} onChange={event => { const speed = Number(event.target.value); if (speed >= model.speedMin && speed <= model.speedMax) update({ speed }) }} /></label>}
    </>}
  </div>
}
