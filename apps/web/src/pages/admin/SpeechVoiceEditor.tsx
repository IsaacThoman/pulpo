import { useId, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { OPENAI_SPEECH_PRESET, type SpeechModel } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'
import { speechVoiceIssues, type VoiceSettings } from './speech-voice-validation'

export function SpeechVoiceEditor({ value, onChange, renderPreview, mistral = false }: { value: VoiceSettings; onChange: (value: VoiceSettings) => void; renderPreview?: (index: number) => ReactNode; mistral?: boolean }) {
  const id = useId()
  const [bulk, setBulk] = useState('')
  const [bulkError, setBulkError] = useState('')
  const { voices, defaultVoice } = value
  const issues = speechVoiceIssues(value)
  const update = (index: number, patch: Partial<SpeechModel['voices'][number]>) => {
    const wasDefault = Boolean(defaultVoice) && voices[index]?.id.trim() === defaultVoice
    onChange({ ...value, voices: voices.map((voice, i) => i === index ? { ...voice, ...patch } : voice),
      defaultVoice: wasDefault && patch.id !== undefined ? patch.id.trim() : defaultVoice })
  }
  const loadPreset = () => {
    const existing = new Set(voices.map(voice => voice.id.trim()))
    const merged = [...voices, ...OPENAI_SPEECH_PRESET.voices.filter(voice => !existing.has(voice.id))]
    if (merged.length > 200) { setBulkError(ui('A model can have at most 200 voices.')); return }
    onChange({ voices: merged, defaultVoice: merged.some(voice => voice.id.trim() === defaultVoice) ? defaultVoice : OPENAI_SPEECH_PRESET.defaultVoice })
    setBulkError('')
  }
  const importVoices = () => {
    const lines = bulk.split('\n').filter(line => line.trim())
    const parsed = lines.map(line => line.split('|').map(part => part.trim()))
    if (!parsed.length || parsed.some(parts => parts.length > 2 || !parts[0])) {
      setBulkError(ui('Enter one voice ID per line, optionally followed by | display name.')); return
    }
    if (voices.length + parsed.length > 200) { setBulkError(ui('A model can have at most 200 voices.')); return }
    onChange({ ...value, voices: [...voices, ...parsed.map(([id, label]) => ({ id: id!, label: label || id! }))] })
    setBulk(''); setBulkError('')
  }
  return <fieldset className="min-w-0 space-y-3">
    <legend className="text-sm font-medium">{ui('Voices')}</legend>
    {renderPreview && <p className="text-xs text-muted-foreground">{ui('Each voice can have an optional MP3 or WAV preview, up to 30 seconds and 5 MiB.')}</p>}
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem_2.25rem] gap-2 text-xs text-muted-foreground" aria-hidden="true">
        <span>{ui('Voice ID')}</span><span>{ui('Display name')}</span><span className="text-center">{ui('Default')}</span><span />
      </div>
      {voices.map((voice, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem_2.25rem] items-start gap-2">
        <div className="min-w-0">
          <Input disabled={voice.kind === 'cloned'} aria-label={ui('Voice ID {{number}}', { number: index + 1 })} aria-invalid={Boolean(issues.rows[index]?.id)} aria-describedby={issues.rows[index]?.id ? `${id}-${index}-id` : undefined} value={voice.id} placeholder={ui('Voice ID')} onChange={event => update(index, { id: event.target.value })} />
          {issues.rows[index]?.id && <p id={`${id}-${index}-id`} className="mt-1 text-xs text-destructive">{issues.rows[index].id}</p>}
        </div>
        <div className="min-w-0">
          <Input aria-label={ui('Voice display name {{number}}', { number: index + 1 })} aria-invalid={Boolean(issues.rows[index]?.label)} aria-describedby={issues.rows[index]?.label ? `${id}-${index}-label` : undefined} value={voice.label} placeholder={ui('Display name')} onChange={event => update(index, { label: event.target.value })} />
          {issues.rows[index]?.label && <p id={`${id}-${index}-label`} className="mt-1 text-xs text-destructive">{issues.rows[index].label}</p>}
        </div>
        <label className="flex h-9 cursor-pointer items-center justify-center">
          <input type="radio" name={`${id}-default`} className="size-4 appearance-none rounded-full border border-muted-foreground! bg-transparent checked:border-primary! checked:bg-primary checked:shadow-[inset_0_0_0_3px_var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40" aria-label={ui('Use voice {{number}} as default', { number: index + 1 })} disabled={Boolean(issues.rows[index]?.id)} checked={Boolean(defaultVoice) && !issues.rows[index]?.id && voice.id.trim() === defaultVoice} onChange={() => onChange({ ...value, defaultVoice: voice.id.trim() })} />
        </label>
        <Button type="button" variant="ghost" size="icon" aria-label={ui('Remove voice {{number}}', { number: index + 1 })} onClick={() => onChange({ ...value, voices: voices.filter((_, i) => i !== index), defaultVoice: voice.id.trim() === defaultVoice ? '' : defaultVoice })}><Trash2 className="size-4" /></Button>
        {renderPreview && <div className="col-span-4 pb-2">{renderPreview(index)}</div>}
      </div>)}
    </div>
    {issues.selection && <p role="status" className="text-xs text-destructive">{issues.selection}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={voices.length >= 200} onClick={() => onChange({ ...value, voices: [...voices, { id: '', label: '' }] })}><Plus className="size-4" />{ui('Add voice')}</Button>
      {!mistral && <Button type="button" variant="outline" size="sm" onClick={loadPreset}>{ui('Load preset voices')}</Button>}
    </div>
    {!mistral && <p className="text-xs text-muted-foreground">{ui('The GPT-4o mini TTS preset adds missing voices and keeps your existing names.')}</p>}
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm">{ui('Bulk paste')}</summary>
      <div className="mt-3 space-y-2">
        <label htmlFor={`${id}-bulk`} className="block text-xs text-muted-foreground">{ui('Enter one voice ID per line, optionally followed by | display name.')}</label>
        <Textarea id={`${id}-bulk`} rows={4} value={bulk} onChange={event => { setBulk(event.target.value); setBulkError('') }} placeholder={'custom-voice | Custom voice'} />
        <Button type="button" variant="outline" size="sm" disabled={!bulk.trim()} onClick={importVoices}>{ui('Add pasted voices')}</Button>
      </div>
    </details>
    {bulkError && <p role="alert" className="text-xs text-destructive">{bulkError}</p>}
  </fieldset>
}
