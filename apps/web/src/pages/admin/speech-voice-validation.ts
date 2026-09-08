import type { SpeechModel } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

export type VoiceSettings = Pick<SpeechModel, 'voices' | 'defaultVoice'>

export function speechVoiceIssues({ voices, defaultVoice }: VoiceSettings) {
  const rows = voices.map(voice => ({
    id: !voice.id.trim() ? ui('Enter a voice ID.')
      : voice.id.trim().length > 200 ? ui('Use 200 characters or fewer.')
      : voices.filter(other => other.id.trim() === voice.id.trim()).length > 1 ? ui('Voice IDs must be unique.') : '',
    label: !voice.label.trim() ? ui('Enter a display name.')
      : voice.label.trim().length > 120 ? ui('Use 120 characters or fewer.') : '',
  }))
  const selection = !voices.length ? ui('Add at least one voice.')
    : !defaultVoice || !voices.some(voice => voice.id.trim() === defaultVoice) ? ui('Choose a default voice.') : ''
  return { rows, selection, invalid: Boolean(selection || rows.some(row => row.id || row.label)) }
}

