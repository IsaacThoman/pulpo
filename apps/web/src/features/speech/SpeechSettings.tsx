import { SPEECH_MAX_INSTRUCTIONS_LENGTH } from '@pulpo/contracts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, Loader2, Play, Square } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQuery } from '@tanstack/react-query'
import { useSettings } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { speechCatalog, speechPlayback, previewSpeechVoice } from './playback'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

export function SpeechSettings() {
  const [openVoiceModel, setOpenVoiceModel] = useState<string | null>(null)
  const voiceList = useRef<HTMLDivElement>(null)
  const closeVoices = () => {
    setOpenVoiceModel(null)
    if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop()
  }
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  useEffect(() => () => { if (speechPlayback.getSnapshot().key?.startsWith('preview:')) speechPlayback.stop() }, [])
  const preferences = useSettings(s => s.speech)
  const set = useSettings(s => s.set)
  const userId = useAuth(s => s.user?.id)
  const catalog = useQuery({ queryKey: ['speech-models', userId], queryFn: speechCatalog })
  const model = catalog.data?.data.find(model => model.id === (preferences.modelId ?? catalog.data?.defaultModelId))
  const settings = model ? preferences.models[model.id] ?? { instructions: '', speed: 1 } : undefined
  const update = (patch: object) => { if (model) set('speech', { ...preferences, models: { ...preferences.models, [model.id]: { ...settings!, ...patch } } }) }
  return <div className="space-y-5">
    <h3 className="text-lg font-semibold">{ui('Speech')}</h3>
    <p className="text-sm text-muted-foreground">{ui('Read messages aloud with an AI-generated voice.')}</p>
    {catalog.isError && <p role="alert">{ui('Speech models could not be loaded.')} <button onClick={() => void catalog.refetch()}>{ui('Retry')}</button></p>}
    <div className="space-y-2">
      <label id="speech-model-label" className="text-sm font-medium">{ui('Model')}</label>
      <Select value={preferences.modelId ?? '@default'} onValueChange={modelId => { closeVoices(); speechPlayback.stop(); set('speech', { ...preferences, modelId: modelId === '@default' ? null : modelId }) }} disabled={catalog.isLoading}>
        <SelectTrigger aria-labelledby="speech-model-label" className="w-full"><SelectValue placeholder={ui(catalog.isLoading ? 'Loading…' : 'Choose a speech model')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="@default">{ui('Use admin default')}</SelectItem>
          {preferences.modelId && !model && <SelectItem value={preferences.modelId} disabled>{ui('Selected model unavailable')}</SelectItem>}
          {catalog.data?.data.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {!preferences.modelId && <p className="text-xs text-muted-foreground">{model ? ui('Admin default: {{name}}', { name: model.name }) : ui('No admin default is available. Choose a speech model to read aloud.')}</p>}
    </div>
    {catalog.data?.data.length === 0 && <p className="text-sm">{ui('An admin must configure a speech model first.')}</p>}
    {model && settings && <>
      <div className="min-w-0 space-y-2">
        <label id="speech-voice-label" className="text-sm font-medium">{ui('Voice')}</label>
        {/* Give the portaled list its own scroll lock inside the modal settings dialog. */}
        <Popover modal open={openVoiceModel === model.id} onOpenChange={open => { if (open) setOpenVoiceModel(model.id); else closeVoices() }}>
          <PopoverTrigger asChild>
            <Button variant="outline" aria-labelledby="speech-voice-label speech-selected-voice" className="h-9 w-full justify-between gap-2 px-3 font-normal">
              <span id="speech-selected-voice" className="truncate">{model.voices.find(voice => voice.id === (settings.voice ?? model.defaultVoice))?.label ?? ui('Selected voice unavailable')}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent ref={voiceList} aria-labelledby="speech-voice-label" align="start" className="relative max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto overscroll-contain p-1" onOpenAutoFocus={event => {
            event.preventDefault()
            const selected = voiceList.current?.querySelector<HTMLInputElement>('input:checked') ?? voiceList.current?.querySelector<HTMLInputElement>('input')
            selected?.focus({ preventScroll: true })
            // Wait for the floating panel to be measured before revealing its selected row.
            requestAnimationFrame(() => {
              const row = selected?.closest('label')?.parentElement
              if (row && voiceList.current) voiceList.current.scrollTop = row.offsetTop - (voiceList.current.clientHeight - row.clientHeight) / 2
            })
          }}>
          <div role="radiogroup" aria-labelledby="speech-voice-label" className="space-y-1" onKeyDown={event => {
            if (event.target instanceof HTMLInputElement && event.key === 'Enter') { event.preventDefault(); event.target.click(); return }
            if (!(event.target instanceof HTMLInputElement) || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
            // Native radio arrows synthesize clicks; handle them here so browsing keeps the panel open.
            event.preventDefault()
            const radios = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input'))
            const index = radios.indexOf(event.target)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + radios.length) % radios.length
            speechPlayback.stop()
            update({ voice: model.voices[next]!.id })
            radios[next]?.focus({ preventScroll: true })
            radios[next]?.scrollIntoView({ block: 'nearest' })
          }}>
          {model.voices.map(voice => {
            const selected = (settings.voice ?? model.defaultVoice) === voice.id
            const active = playback.key === `preview:${model.id}:${voice.id}`
            return <div key={voice.id} className={cn('flex items-center gap-2 rounded-md px-3 transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring', selected && 'bg-muted')}>
              {/* Anchor the hidden radio to its row so focus scrolls the list, not the dialog. */}
              <label className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3">
                <input className="sr-only" type="radio" name="speech-voice" aria-label={voice.label} checked={selected} onClick={closeVoices} onChange={() => { speechPlayback.stop(); update({ voice: voice.id }) }} />
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{voice.label}</span>
                {selected && <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </label>
              {voice.previewAvailable && <Button variant="outline" size="icon" className="shrink-0 rounded-full" aria-label={active ? ui('Stop preview') : ui('Preview {{name}}', { name: voice.label })} aria-pressed={active} onClick={() => void previewSpeechVoice(model.id, voice.id)}>
                {active ? playback.phase === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5" /> : <Play className="size-4" />}
              </Button>}
            </div>
          })}
          </div>
          </PopoverContent>
        </Popover>
        {settings.voice !== undefined && <Button variant="ghost" size="sm" onClick={() => { closeVoices(); speechPlayback.stop(); update({ voice: undefined }) }}>{ui('Use default voice')}</Button>}
        {playback.error && <p role="alert" className="text-sm text-destructive">{ui(playback.error)}</p>}
      </div>
      {model.supportsInstructions && <label className="block text-sm">{ui('Instructions')}<Textarea className="mt-2" value={settings.instructions} maxLength={SPEECH_MAX_INSTRUCTIONS_LENGTH} placeholder={ui('Speak in a calm, friendly tone.')} onChange={event => update({ instructions: event.target.value })} /></label>}
      {model.supportsSpeed && <label className="block text-sm">{ui('Speed')}<Input className="mt-2" type="number" min={model.speedMin} max={model.speedMax} step="0.05" value={settings.speed} onChange={event => { const speed = Number(event.target.value); if (speed >= model.speedMin && speed <= model.speedMax) update({ speed }) }} /></label>}
    </>}
  </div>
}
