import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { NumField, SaveBar, SecretField, Section, Toggle } from '@/components/admin/kit'
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
}

export function DictationSection() {
  const [enabled, setEnabled] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const groqApiKey = useSavedSecret(hasApiKey, '/api/admin/settings/dictation/api-key/reveal')
  const [billUsers, setBillUsers] = useState(false)
  const [pricePerMinuteMicros, setPricePerMinuteMicros] = useState(10_000)

  useEffect(() => {
    void apiRequest<DictationSettingsResponse>('/api/admin/settings/dictation').then((value) => {
      setEnabled(value.enabled)
      setHasApiKey(value.hasApiKey)
      setBillUsers(value.billUsers)
      setPricePerMinuteMicros(value.pricePerMinuteMicros)
    })
  }, [])

  const keyAvailable = hasApiKey || Boolean(groqApiKey.value.trim())
  return <div>
    <Section title={ui("Dictation")} hint="Transcribe microphone recordings on the server with Groq Whisper Large v3 Turbo. Audio is not retained by Pulpo.">
      <Toggle
        label={ui("Enable dictation")}
        hint="Shows the microphone control in the web chat composer. Disabled by default."
        checked={enabled}
        onChange={setEnabled}
      />
      {enabled && !keyAvailable && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />{ui("Configure a Groq API key before enabling dictation.")}</div>}
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
    <Section title={ui("Groq")} hint={ui("The API key is encrypted on the Pulpo server. Confirm your identity to reveal the saved key.")}>
      <SecretField
        label={ui("Groq API key")}
        hint={hasApiKey ? 'Configured — leave blank to keep' : 'Required before dictation can be enabled'}
        {...groqApiKey.fieldProps}
      />
    </Section>
    <SaveBar onSave={async () => {
      if (enabled && !keyAvailable) throw new Error(ui("Configure a Groq API key before enabling dictation"))
      const saved = await apiRequest<DictationSettingsResponse>('/api/admin/settings/dictation', {
        method: 'PATCH', body: { enabled, billUsers, pricePerMinuteMicros, ...(groqApiKey.replacement.trim() ? { groqApiKey: groqApiKey.replacement.trim() } : {}) },
      })
      setEnabled(saved.enabled)
      setHasApiKey(saved.hasApiKey)
      groqApiKey.reset()
      setBillUsers(saved.billUsers)
      setPricePerMinuteMicros(saved.pricePerMinuteMicros)
      useAuth.setState({ dictationEnabled: saved.enabled && saved.hasApiKey })
    }} />
    <SensitiveRevealDialog
      {...groqApiKey.dialogProps}
      description={ui("Groq API keys are sensitive. Confirm your identity before revealing this saved key.")}
    />
  </div>
}
