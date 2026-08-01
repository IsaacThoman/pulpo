import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { useAuth } from '@/stores/auth'
import { apiRequest } from '@/lib/api'

const DEFAULT_SUGGESTED_PROMPTS = [
  { id: '1', label: 'What can you help me build today?', message: 'What can you help me build today?' },
  { id: '2', label: 'Explain how KV caching speeds up decoding', message: 'Explain how KV caching speeds up decoding' },
  { id: '3', label: 'Draft a terse commit message for a sidebar refactor', message: 'Draft a terse commit message for a sidebar refactor' },
  { id: '4', label: 'Compare mixture-of-experts vs dense models', message: 'Compare mixture-of-experts vs dense models' },
]

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
    defaultSignupRole: 'pending' as 'pending' | 'user',
    apiKeysEnabled: true,
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
          decimals={2}
          suffix="USD"
        />
        <SelectField label="Default user role" hint="Role assigned to future public signups." value={t.defaultSignupRole} onChange={(v) => s('defaultSignupRole', v as 'pending' | 'user')} options={[{ value: 'pending', label: 'Pending approval' }, { value: 'user', label: 'User' }]} />
        <Toggle label="Enable API keys" hint="Suspends API-key creation and authentication without deleting existing keys." checked={t.apiKeysEnabled} onChange={(v) => s('apiKeysEnabled', v)} />
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

      <SaveBar onSave={async () => { await save(); auth.setSignupEnabled(t.signupEnabled); useAuth.setState({ pendingDetails: t.pendingDetails, adminEmail: t.adminEmail, pendingMessage: t.pendingMessage, apiKeysEnabled: t.apiKeysEnabled }) }} />
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
    suggestedPromptsEnabled: true,
    suggestedPromptsCount: 4,
    suggestedPrompts: DEFAULT_SUGGESTED_PROMPTS,
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))
  const prompts = Array.isArray(t.suggestedPrompts) ? t.suggestedPrompts : DEFAULT_SUGGESTED_PROMPTS
  const updatePrompt = (index: number, patch: Partial<(typeof DEFAULT_SUGGESTED_PROMPTS)[number]>) =>
    s('suggestedPrompts', prompts.map((item, i) => (i === index ? { ...item, ...patch } : item)))

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

      <Section
        title="Suggested prompts"
        hint="Starter buttons shown on empty chats. A random subset is picked each time."
      >
        <Toggle
          label="Show suggested prompts"
          checked={t.suggestedPromptsEnabled}
          onChange={(v) => s('suggestedPromptsEnabled', v)}
        />
        {t.suggestedPromptsEnabled && (
          <>
            <NumField
              label="Prompts shown"
              hint="How many buttons to show on new chats."
              value={t.suggestedPromptsCount}
              onChange={(v) => s('suggestedPromptsCount', Math.max(0, Math.min(12, Math.round(v))))}
              min={0}
              max={12}
              indent
            />
            <div className="space-y-3 pt-1">
              {prompts.map((prompt, index) => (
                <div key={prompt.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2">
                      <div>
                        <div className="mb-1 text-xs text-muted-foreground">Button label</div>
                        <Input
                          className="h-8"
                          value={prompt.label}
                          onChange={(e) => updatePrompt(index, { label: e.target.value })}
                          placeholder="Shown on the button"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-muted-foreground">Message</div>
                        <Input
                          className="h-8"
                          value={prompt.message}
                          onChange={(e) => updatePrompt(index, { message: e.target.value })}
                          placeholder="Submitted when clicked"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mt-5"
                      aria-label="Remove prompt"
                      onClick={() => s('suggestedPrompts', prompts.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {prompts.length < 50 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    s('suggestedPrompts', [
                      ...prompts,
                      { id: crypto.randomUUID(), label: 'New prompt', message: 'New prompt' },
                    ])
                  }
                >
                  <Plus className="size-3.5" />
                  Add prompt
                </Button>
              )}
            </div>
          </>
        )}
      </Section>

      <SaveBar onSave={save} />
    </div>
  )
}
