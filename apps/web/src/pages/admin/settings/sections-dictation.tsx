import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { NumField, SaveBar, SecretField, Section, Toggle } from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'

interface DictationSettingsResponse {
  enabled: boolean
  billUsers: boolean
  pricePerMinuteMicros: number
  hasApiKey: boolean
}

export function DictationSection() {
  const [enabled, setEnabled] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [groqApiKey, setGroqApiKey] = useState('')
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

  const keyAvailable = hasApiKey || Boolean(groqApiKey.trim())
  return <div>
    <Section title="Dictation" hint="Transcribe microphone recordings on the server with Groq Whisper Large v3 Turbo. Audio is not retained by Pulpo.">
      <Toggle
        label="Enable web dictation"
        hint="Shows the microphone control in the web chat composer. Disabled by default."
        checked={enabled}
        onChange={setEnabled}
      />
      {enabled && !keyAvailable && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />Configure a Groq API key before enabling dictation.</div>}
      <Toggle label="Bill users for dictation" hint="Charges successful transcriptions by audio duration, rounded up to the next second." checked={billUsers} onChange={setBillUsers} />
      {billUsers && <NumField
        label="Price per dictation minute"
        value={pricePerMinuteMicros / 1_000_000}
        onChange={(usd) => setPricePerMinuteMicros(Math.round(usd * 1_000_000))}
        min={0}
        step={0.001}
        decimals={4}
        suffix="USD"
      />}
    </Section>
    <Section title="Groq" hint="The API key is encrypted on the Pulpo server and is never sent to the browser.">
      <SecretField
        label="Groq API key"
        hint={hasApiKey ? 'Configured — leave blank to keep' : 'Required before dictation can be enabled'}
        value={groqApiKey}
        onChange={setGroqApiKey}
        configured={hasApiKey}
      />
    </Section>
    <SaveBar onSave={async () => {
      if (enabled && !keyAvailable) throw new Error('Configure a Groq API key before enabling dictation')
      const saved = await apiRequest<DictationSettingsResponse>('/api/admin/settings/dictation', {
        method: 'PATCH', body: { enabled, billUsers, pricePerMinuteMicros, ...(groqApiKey.trim() ? { groqApiKey: groqApiKey.trim() } : {}) },
      })
      setEnabled(saved.enabled)
      setHasApiKey(saved.hasApiKey)
      setGroqApiKey('')
      setBillUsers(saved.billUsers)
      setPricePerMinuteMicros(saved.pricePerMinuteMicros)
      useAuth.setState({ dictationEnabled: saved.enabled && saved.hasApiKey })
    }} />
  </div>
}
