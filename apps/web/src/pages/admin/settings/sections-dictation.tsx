import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { NumField, SaveBar, SecretField, Section, SelectField, Toggle } from '@/components/admin/kit'
import { SensitiveRevealDialog } from '@/components/admin/SensitiveRevealDialog'
import { useSavedSecret } from '@/components/admin/useSavedSecret'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

interface DictationSettingsResponse {
  enabled: boolean
  billUsers: boolean
  pricePerMinuteMicros: number
  hasApiKey: boolean
  provider: 'groq' | 'whisper'
  whisperConfigured: boolean
}

export function DictationSection() {
  const [enabled, setEnabled] = useState(false)
  const [provider, setProvider] = useState<DictationSettingsResponse['provider']>('groq')
  const [whisperConfigured, setWhisperConfigured] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const groqApiKey = useSavedSecret(hasApiKey, '/api/admin/settings/dictation/api-key/reveal')
  const [billUsers, setBillUsers] = useState(false)
  const [pricePerMinuteMicros, setPricePerMinuteMicros] = useState(10_000)

  useEffect(() => {
    void apiRequest<DictationSettingsResponse>('/api/admin/settings/dictation').then((value) => {
      setEnabled(value.enabled)
      setProvider(value.provider ?? 'groq')
      setWhisperConfigured(Boolean(value.whisperConfigured))
      setHasApiKey(value.hasApiKey)
      setBillUsers(value.billUsers)
      setPricePerMinuteMicros(value.pricePerMinuteMicros)
    })
  }, [])

  const providerReady = provider === 'whisper' ? whisperConfigured : hasApiKey || Boolean(groqApiKey.value.trim())
  const configurationMessage = provider === 'whisper'
    ? ui("Configure the Whisper service on the Pulpo server before enabling dictation.")
    : ui("Configure a Groq API key before enabling dictation.")
  return <div>
    <Section title={ui("Dictation")} hint={ui("Transcribe microphone recordings and audio files with Whisper Large v3 Turbo.")}>
      <Toggle
        label={ui("Enable dictation")}
        hint={ui("Enables the microphone in the composer and the Transcribe button in audio previews.")}
        checked={enabled}
        onChange={setEnabled}
      />
      {(whisperConfigured || provider === 'whisper') && <SelectField
        label={ui("Transcription provider")}
        value={provider}
        onChange={setProvider}
        options={[
          { value: 'groq', label: ui("Groq") },
          { value: 'whisper', label: ui("Self-hosted Whisper") },
        ]}
      />}
      {enabled && !providerReady && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />{configurationMessage}</div>}
      <Toggle label={ui("Bill users for dictation")} hint="Charges successful transcriptions by audio duration, rounded up to the next second." checked={billUsers} onChange={setBillUsers} />
      {billUsers && <NumField
        label={ui("Price per dictation minute")}
        value={pricePerMinuteMicros / 1_000_000}
        onChange={(usd) => setPricePerMinuteMicros(Math.round(usd * 1_000_000))}
        min={0}
        step={0.001}
        decimals={4}
        suffix="USD"
      />}
    </Section>
    {provider === 'groq' && <Section title={ui("Groq")} hint={ui("The API key is encrypted on the Pulpo server. Confirm your identity to reveal the saved key.")}>
      <SecretField
        label={ui("Groq API key")}
        hint={hasApiKey ? 'Configured — leave blank to keep' : 'Required before dictation can be enabled'}
        {...groqApiKey.fieldProps}
      />
    </Section>}
    <SaveBar onSave={async () => {
      if (enabled && !providerReady) throw new Error(configurationMessage)
      const saved = await apiRequest<DictationSettingsResponse>('/api/admin/settings/dictation', {
        method: 'PATCH', body: { enabled, provider, billUsers, pricePerMinuteMicros, ...(provider === 'groq' && groqApiKey.replacement.trim() ? { groqApiKey: groqApiKey.replacement.trim() } : {}) },
      })
      setEnabled(saved.enabled)
      setHasApiKey(saved.hasApiKey)
      groqApiKey.reset()
      setBillUsers(saved.billUsers)
      setPricePerMinuteMicros(saved.pricePerMinuteMicros)
      const savedProvider = saved.provider ?? 'groq'
      setProvider(savedProvider)
      setWhisperConfigured(Boolean(saved.whisperConfigured))
      useAuth.setState({ dictationEnabled: saved.enabled && (savedProvider === 'whisper' ? saved.whisperConfigured : saved.hasApiKey) })
    }} />
    <SensitiveRevealDialog
      {...groqApiKey.dialogProps}
      description={ui("Groq API keys are sensitive. Confirm your identity before revealing this saved key.")}
    />
  </div>
}
