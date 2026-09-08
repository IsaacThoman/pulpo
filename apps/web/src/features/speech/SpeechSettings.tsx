import { useQuery } from '@tanstack/react-query'
import { speechPriceLabel } from '@pulpo/contracts'
import { useSettings } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { speechCatalog } from './playback'
import { ui } from '@/i18n/ui'

export function SpeechSettings() {
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
    <label className="block text-sm">{ui('Model')}<select aria-label={ui('Model')} className="mt-2 block w-full rounded-md border bg-background p-2" value={preferences.modelId ?? ''} onChange={event => set('speech', { ...preferences, modelId: event.target.value || null })}>
      <option value="">{catalog.isLoading ? ui('Loading…') : ui('Choose a speech model')}</option>
      {preferences.modelId && !model && <option value={preferences.modelId}>{ui('Selected model unavailable')}</option>}
      {catalog.data?.data.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select></label>
    {catalog.data?.data.length === 0 && <p className="text-sm">{ui('An admin must configure a speech model first.')}</p>}
    {model && settings && <>
      <label className="block text-sm">{ui('Voice')}<select aria-label={ui('Voice')} className="mt-2 block w-full rounded-md border bg-background p-2" value={settings.voice ?? model.defaultVoice} onChange={event => update({ voice: event.target.value })}>
        {settings.voice && !model.voices.some(v => v.id === settings.voice) && <option value={settings.voice}>{ui('Selected voice unavailable')}</option>}
        {model.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
      </select></label>
      {model.supportsInstructions && <label className="block text-sm">{ui('Instructions')}<Textarea className="mt-2" value={settings.instructions} maxLength={4096} placeholder={ui('Speak in a calm, friendly tone.')} onChange={event => update({ instructions: event.target.value })} /></label>}
      {model.supportsSpeed && <label className="block text-sm">{ui('Speed')}<Input className="mt-2" type="number" min={model.speedMin} max={model.speedMax} step="0.05" value={settings.speed} onChange={event => { const speed = Number(event.target.value); if (speed >= model.speedMin && speed <= model.speedMax) update({ speed }) }} /></label>}
      <p className="text-sm">{speechPriceLabel(model)}</p><p className="text-xs text-muted-foreground">{ui('Charges apply to generated audio, including a prepared next chunk when playback stops.')}</p>
    </>}
  </div>
}
