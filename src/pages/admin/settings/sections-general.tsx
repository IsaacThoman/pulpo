import { useEffect, useState } from 'react'
import {
  Field,
  NumField,
  SaveBar,
  Section,
  SelectField,
  TextAreaField,
  TextField,
  Toggle,
} from '@/components/admin/kit'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth'
import { apiRequest } from '@/lib/api'

interface AdminSettings { values: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function useAdminSetting<T>(key: string, initial: T) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    void apiRequest<AdminSettings>('/api/admin/settings').then((result) => {
      if (result.values[key] !== undefined) {
        const stored = result.values[key]
        setValue((current) => isRecord(current) && isRecord(stored)
          ? { ...current, ...stored } as T
          : stored as T)
      }
    })
  }, [key])
  const save = async () => { await apiRequest('/api/admin/settings', { method: 'PATCH', body: { [key]: value } }) }
  return [value, setValue, save] as const
}

export function GeneralSection() {
  const [publicUrl, setPublicUrl, save] = useAdminSetting('publicUrl', location.origin)

  return (
    <div>
      <Section title="Version">
        <Field label="Pulpo" hint="Self-hosted source build">
          <Button variant="outline" size="sm">
            Check for updates
          </Button>
        </Field>
      </Section>

      <Section title="General">
        <TextField label="Public URL" value={publicUrl} onChange={setPublicUrl} mono />
      </Section>

      <SaveBar onSave={save} />
    </div>
  )
}

export function AuthenticationSection() {
  const auth = useAuth()
  const [t, setT, save] = useAdminSetting('auth', {
    signupEnabled: auth.signupEnabled,
    defaultBalanceMicros: 5_000_000,
    pendingDetails: auth.pendingDetails,
    adminEmail: auth.adminEmail,
    pendingMessage: auth.pendingMessage,
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <div>
      <Section title="User access">
        <Toggle
          label="Enable new sign ups"
          checked={t.signupEnabled}
          onChange={(v) => s('signupEnabled', v)}
        />
        <NumField
          label="Default balance"
          hint="Credit assigned to each newly created user."
          value={t.defaultBalanceMicros / 1_000_000}
          onChange={(value) => s('defaultBalanceMicros', Math.round(Math.max(0, value) * 1_000_000))}
          min={0}
          step={0.01}
          suffix="USD"
        />
      </Section>

      <Section title="Pending accounts">
        <Toggle
          label="Show admin details in pending overlay"
          checked={t.pendingDetails}
          onChange={(v) => s('pendingDetails', v)}
        />
        {t.pendingDetails && (
          <TextField
            label="Admin contact email"
            value={t.adminEmail}
            onChange={(v) => s('adminEmail', v)}
            indent
          />
        )}
        <TextAreaField
          label="Pending overlay content"
          value={t.pendingMessage}
          onChange={(v) => s('pendingMessage', v)}
        />
      </Section>

      <SaveBar onSave={async () => { await save(); auth.setSignupEnabled(t.signupEnabled); useAuth.setState({ pendingDetails: t.pendingDetails, adminEmail: t.adminEmail, pendingMessage: t.pendingMessage }) }} />
    </div>
  )
}

export function InterfaceSection() {
  const [t, setT, save] = useAdminSetting('interface', {
    localTask: 'current',
    compaction: true,
    compactionTokens: 12000,
    title: true,
    titlePrompt: 'Create a concise 3-5 word title for this chat.',
    followUp: true,
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <div>
      <Section
        title="Task model"
        hint="Small model used for background tasks like titles and follow-ups."
      >
        <SelectField
          label="Task model"
          value={t.localTask}
          onChange={(v) => s('localTask', v)}
          options={[
            { value: 'current', label: 'Current model' },
            { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
            { value: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
          ]}
        />
      </Section>

      <Section title="Tasks">
        <Toggle label="Context compaction" checked={t.compaction} onChange={(v) => s('compaction', v)} />
        {t.compaction && (
          <NumField
            label="Token threshold"
            value={t.compactionTokens}
            onChange={(v) => s('compactionTokens', v)}
            indent
          />
        )}
        <Toggle label="Title generation" checked={t.title} onChange={(v) => s('title', v)} />
        {t.title && (
          <div className="pl-4">
            <TextAreaField label="Title prompt" value={t.titlePrompt} onChange={(v) => s('titlePrompt', v)} />
          </div>
        )}
        <Toggle label="Follow-up generation" checked={t.followUp} onChange={(v) => s('followUp', v)} />
      </Section>

      <SaveBar onSave={save} />
    </div>
  )
}
