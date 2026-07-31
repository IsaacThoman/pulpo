import { useState } from 'react'
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

export function GeneralSection() {
  const [publicUrl, setPublicUrl] = useState('https://chat.pulpo.dev')

  return (
    <div>
      <Section title="Version">
        <Field label="pulpo" hint="0.10.2-mock — you are on the latest version.">
          <Button variant="outline" size="sm">
            Check for updates
          </Button>
        </Field>
      </Section>

      <Section title="General">
        <TextField label="Public URL" value={publicUrl} onChange={setPublicUrl} mono />
      </Section>

      <SaveBar />
    </div>
  )
}

export function AuthenticationSection() {
  const [t, setT] = useState({
    role: 'pending' as string,
    signup: true,
    apiKeys: true,
    pendingDetails: true,
    adminEmail: 'isaac@pulpo.dev',
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <div>
      <Section title="User access">
        <SelectField
          label="Default user role"
          value={t.role}
          onChange={(v) => s('role', v)}
          options={[
            { value: 'pending', label: 'pending' },
            { value: 'user', label: 'user' },
            { value: 'admin', label: 'admin' },
          ]}
        />
        <Toggle label="Enable new sign ups" checked={t.signup} onChange={(v) => s('signup', v)} />
        <Toggle label="Enable API keys" checked={t.apiKeys} onChange={(v) => s('apiKeys', v)} />
      </Section>

      <Section title="Pending accounts">
        <Toggle
          label="Show admin details in pending overlay"
          checked={t.pendingDetails}
          onChange={(v) => s('pendingDetails', v)}
        />
        {t.pendingDetails && (
          <TextField label="Admin contact email" value={t.adminEmail} onChange={(v) => s('adminEmail', v)} indent />
        )}
        <TextAreaField label="Pending overlay content" value={'Your account is pending approval. An admin will review it shortly.'} onChange={() => {}} />
      </Section>

      <SaveBar />
    </div>
  )
}

export function InterfaceSection() {
  const [t, setT] = useState({
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
          label="Local task model"
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

      <SaveBar />
    </div>
  )
}
