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
  const [t, setT] = useState({
    community: true,
    rating: true,
    folders: true,
    folderMax: 50,
    memories: true,
    memoryCtx: true,
    notes: true,
    webhooks: true,
    userStatus: true,
    watermark: '',
    webuiUrl: 'https://chat.pulpo.dev',
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <div>
      <Section title="Version">
        <Field label="pulpo" hint="0.10.2-mock — you are on the latest version.">
          <Button variant="outline" size="sm">
            Check for updates
          </Button>
        </Field>
      </Section>

      <Section title="Features">
        <Toggle label="Enable community sharing" checked={t.community} onChange={(v) => s('community', v)} />
        <Toggle label="Enable message rating" checked={t.rating} onChange={(v) => s('rating', v)} />
        <Toggle label="Folders" checked={t.folders} onChange={(v) => s('folders', v)} />
        {t.folders && (
          <NumField label="Folder max file count" value={t.folderMax} onChange={(v) => s('folderMax', v)} indent />
        )}
        <Toggle label="Memories" checked={t.memories} onChange={(v) => s('memories', v)} />
        {t.memories && (
          <Toggle label="Memory system context" checked={t.memoryCtx} onChange={(v) => s('memoryCtx', v)} indent />
        )}
        <Toggle label="Notes" checked={t.notes} onChange={(v) => s('notes', v)} />
        <Toggle label="User webhooks" checked={t.webhooks} onChange={(v) => s('webhooks', v)} />
        <Toggle label="User status" checked={t.userStatus} onChange={(v) => s('userStatus', v)} />
        <TextAreaField
          label="Response watermark"
          hint="Appended to every assistant response."
          value={t.watermark}
          onChange={(v) => s('watermark', v)}
        />
        <TextField label="WebUI URL" value={t.webuiUrl} onChange={(v) => s('webuiUrl', v)} mono />
      </Section>

      <SaveBar />
    </div>
  )
}

export function AuthenticationSection() {
  const [t, setT] = useState({
    role: 'pending' as string,
    group: 'none' as string,
    signup: true,
    apiKeys: true,
    apiKeyRestrict: false,
    allowedEndpoints: '/chat/completions,/models',
    jwt: '10d',
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
        <SelectField
          label="Default group"
          value={t.group}
          onChange={(v) => s('group', v)}
          options={[
            { value: 'none', label: 'None' },
            { value: 'engineering', label: 'engineering' },
            { value: 'externals', label: 'externals' },
          ]}
        />
        <Toggle label="Enable new sign ups" checked={t.signup} onChange={(v) => s('signup', v)} />
        <Toggle label="Enable API keys" checked={t.apiKeys} onChange={(v) => s('apiKeys', v)} />
        {t.apiKeys && (
          <>
            <Toggle
              label="API key endpoint restrictions"
              checked={t.apiKeyRestrict}
              onChange={(v) => s('apiKeyRestrict', v)}
              indent
            />
            {t.apiKeyRestrict && (
              <TextField
                label="Allowed endpoints"
                value={t.allowedEndpoints}
                onChange={(v) => s('allowedEndpoints', v)}
                mono
                indent
              />
            )}
          </>
        )}
        <TextField
          label="JWT expiration"
          hint='e.g. "30m", "1h", "10d". "-1" disables expiry (not recommended).'
          value={t.jwt}
          onChange={(v) => s('jwt', v)}
          mono
        />
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
    tags: true,
    retrievalQuery: false,
    autocomplete: false,
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <div>
      <Section title="Task model" hint="Small model used for background tasks like titles and tags.">
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
        <Toggle label="Tags generation" checked={t.tags} onChange={(v) => s('tags', v)} />
        <Toggle label="Retrieval query generation" checked={t.retrievalQuery} onChange={(v) => s('retrievalQuery', v)} />
        <Toggle label="Autocomplete generation" checked={t.autocomplete} onChange={(v) => s('autocomplete', v)} />
      </Section>

      <SaveBar />
    </div>
  )
}
