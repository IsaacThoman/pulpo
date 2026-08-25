import { useEffect, useMemo, useState } from 'react'
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
import { modelOptionLabel, useAvailableModels } from './use-available-models'
import { NewAccountModelDefaultsFields } from './new-account-model-defaults'
import { DEFAULT_MAX_ATTACHMENT_BYTES, MAX_CONFIGURABLE_ATTACHMENT_BYTES } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

const DEFAULT_SUGGESTED_PROMPTS = [
  { id: '1', label: ui("What can you help me build today?"), message: 'What can you help me build today?' },
  { id: '2', label: ui("Explain how KV caching speeds up decoding"), message: 'Explain how KV caching speeds up decoding' },
  { id: '3', label: ui("Draft a terse commit message for a sidebar refactor"), message: 'Draft a terse commit message for a sidebar refactor' },
  { id: '4', label: ui("Compare mixture-of-experts vs dense models"), message: 'Compare mixture-of-experts vs dense models' },
]

const DEFAULT_TITLE_PROMPT = `### Task:
Generate a concise, 3-5 word title with an emoji summarizing the chat history.
### Guidelines:
- The title should clearly represent the main theme or subject of the conversation.
- Use emojis that enhance understanding of the topic, but avoid quotation marks or special formatting.
- Use an emoji as the first character of the title
- Write the title in the chat's primary language; default to English if multilingual.
- Prioritize accuracy over excessive creativity; keep it clear and simple.
### Output:
JSON format: { "title": "your concise title here" }
### Examples:
- { "title": "📉 Stock Market Trends" },
- { "title": "🍪 Perfect Chocolate Chip Recipe" },
- { "title": "🎶 Evolution of Music Streaming" },
- { "title": "💻 Remote Work Productivity Tips" },
- { "title": "👀 Artificial Intelligence in Healthcare" },
- { "title": "🎮 Video Game Development Insights" }`

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
  const [publicUrl, setPublicUrl] = useState(location.origin)
  useEffect(() => {
    void apiRequest<{ instance: { publicUrl: string } }>('/api/management/v1/info')
      .then((result) => setPublicUrl(result.instance.publicUrl))
  }, [])

  return (
    <div>
      <Section title={ui("Version")}>
        <Field label="Pulpo" hint="Self-hosted source build">
          <Button variant="outline" size="sm"> {ui("Check for updates")} </Button>
        </Field>
      </Section>

      <Section title={ui("General")}>
        <TextField label={ui("Public URL")} hint="Managed by the PUBLIC_URL deployment setting." value={publicUrl} mono disabled />
      </Section>
    </div>
  )
}

export function AuthenticationSection() {
  const auth = useAuth()
  const models = useAvailableModels()
  const [t, setT, save] = useAdminSetting('auth', {
    signupEnabled: auth.signupEnabled,
    defaultBalanceMicros: 5_000_000,
    defaultStorageLimitBytes: 5_000 * 1024 * 1024,
    maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
    pendingDetails: auth.pendingDetails,
    adminEmail: auth.adminEmail,
    pendingMessage: auth.pendingMessage,
    defaultSignupRole: 'pending' as 'pending' | 'user',
      apiKeysEnabled: true,
      inviteCodesEnabled: false,
      newAccountModelDefaults: {
      defaultModelId: null as string | null,
      favoriteModelIds: [] as string[],
    },
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))

  return (
    <div>
      <Section title={ui("User access")}>
        <Toggle
          label={ui("Enable new sign ups")}
          checked={t.signupEnabled}
          onChange={(v) => s('signupEnabled', v)}
        />
        <NumField
          label={ui("Default balance")}
          hint="Credit assigned to each newly created user."
          value={t.defaultBalanceMicros / 1_000_000}
          onChange={(value) => s('defaultBalanceMicros', Math.round(Math.max(0, value) * 1_000_000))}
          min={0}
          step={0.01}
          decimals={2}
          suffix="USD"
        />
        <NumField
          label={ui("Default file storage")}
          hint="Storage allowance assigned to each newly created user."
          value={t.defaultStorageLimitBytes / (1024 * 1024)}
          onChange={(value) => s('defaultStorageLimitBytes', Math.round(Math.max(0, value) * 1024 * 1024))}
          min={0}
          step={100}
          suffix="MiB"
        />
        <NumField
          label={ui("Maximum attachment size")}
          hint={`Per-file upload limit, up to ${MAX_CONFIGURABLE_ATTACHMENT_BYTES / (1024 * 1024)} MiB. Set to 0 to disable attachments.`}
          value={t.maxAttachmentBytes / (1024 * 1024)}
          onChange={(value) => s('maxAttachmentBytes', Math.round(Math.max(0, value) * 1024 * 1024))}
          min={0}
          max={MAX_CONFIGURABLE_ATTACHMENT_BYTES / (1024 * 1024)}
          step={5}
          suffix="MiB"
        />
        <SelectField label={ui("Default user role")} hint="Role assigned to future public signups." value={t.defaultSignupRole} onChange={(v) => s('defaultSignupRole', v as 'pending' | 'user')} options={[{ value: 'pending', label: ui("Pending approval") }, { value: 'user', label: ui("User") }]} />
        <Toggle label={ui("Enable API keys")} hint="Suspends API-key creation and authentication without deleting existing keys." checked={t.apiKeysEnabled} onChange={(v) => s('apiKeysEnabled', v)} />
      </Section>

      <Section title={ui("Pending accounts")}>
        <Toggle
          label={ui("Show admin details in pending overlay")}
          checked={t.pendingDetails}
          onChange={(v) => s('pendingDetails', v)}
        />
        {t.pendingDetails && (
          <TextField
            label={ui("Admin contact email")}
            value={t.adminEmail}
            onChange={(v) => s('adminEmail', v)}
            indent
          />
        )}
        <TextAreaField
          label={ui("Pending overlay content")}
          value={t.pendingMessage}
          onChange={(v) => s('pendingMessage', v)}
        />
      </Section>

      <NewAccountModelDefaultsFields
        value={t.newAccountModelDefaults}
        models={models}
        onChange={(value) => s('newAccountModelDefaults', value)}
      />

      <SaveBar onSave={async () => { await save(); auth.setSignupEnabled(t.signupEnabled); useAuth.setState({ pendingDetails: t.pendingDetails, adminEmail: t.adminEmail, pendingMessage: t.pendingMessage, apiKeysEnabled: t.apiKeysEnabled, maxAttachmentBytes: t.maxAttachmentBytes }) }} />
    </div>
  )
}

export function InterfaceSection() {
  const models = useAvailableModels()
  const [t, setT, save] = useAdminSetting('interface', {
    localTask: 'current',
    title: true,
    titlePrompt: DEFAULT_TITLE_PROMPT,
    titleIncludeFirstCharacters: 8000,
    titleIncludeLastCharacters: 8000,
    followUp: true,
    suggestedPromptsEnabled: true,
    suggestedPromptsCount: 4,
    suggestedPrompts: DEFAULT_SUGGESTED_PROMPTS,
  })
  const s = (k: keyof typeof t, v: (typeof t)[typeof k]) => setT((x) => ({ ...x, [k]: v }))
  const prompts = Array.isArray(t.suggestedPrompts) ? t.suggestedPrompts : DEFAULT_SUGGESTED_PROMPTS
  const taskModelOptions = useMemo(() => {
    const options = [
      { value: 'current', label: ui("Current model") },
      ...models.map((model) => ({ value: model.id, label: modelOptionLabel(model) })),
    ]
    if (t.localTask !== 'current' && !models.some((model) => model.id === t.localTask)) {
      options.push({ value: t.localTask, label: `Unavailable (${t.localTask})` })
    }
    return options
  }, [models, t.localTask])
  const updatePrompt = (index: number, patch: Partial<(typeof DEFAULT_SUGGESTED_PROMPTS)[number]>) =>
    s('suggestedPrompts', prompts.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  return (
    <div>
      <Section
        title={ui("Task model")}
        hint="Small model used for background tasks like titles and follow-ups."
      >
        <SelectField
          label={ui("Task model")}
          value={t.localTask}
          onChange={(v) => s('localTask', v)}
          options={taskModelOptions}
        />
      </Section>

      <Section title={ui("Tasks")}>
        <Toggle label={ui("Title generation")} checked={t.title} onChange={(v) => s('title', v)} />
        {t.title && (
          <div className="space-y-3 pl-4">
            <TextAreaField label={ui("Title prompt")} value={t.titlePrompt} onChange={(v) => s('titlePrompt', v)} />
            <NumField
              label={ui("Include first characters")}
              hint="Characters included from the beginning of the chat history."
              value={t.titleIncludeFirstCharacters}
              onChange={(v) => s('titleIncludeFirstCharacters', Math.max(0, Math.round(v)))}
              min={0}
            />
            <NumField
              label={ui("Include last characters")}
              hint="Characters included from the end. Overlapping ranges are included only once."
              value={t.titleIncludeLastCharacters}
              onChange={(v) => s('titleIncludeLastCharacters', Math.max(0, Math.round(v)))}
              min={0}
            />
          </div>
        )}
        <Toggle label={ui("Follow-up generation")} checked={t.followUp} onChange={(v) => s('followUp', v)} />
      </Section>

      <Section
        title={ui("Suggested prompts")}
        hint="Starter buttons shown on empty chats. A random subset is picked each time."
      >
        <Toggle
          label={ui("Show suggested prompts")}
          checked={t.suggestedPromptsEnabled}
          onChange={(v) => s('suggestedPromptsEnabled', v)}
        />
        {t.suggestedPromptsEnabled && (
          <>
            <NumField
              label={ui("Prompts shown")}
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
                        <div className="mb-1 text-xs text-muted-foreground">{ui("Button label")}</div>
                        <Input
                          className="h-8"
                          value={prompt.label}
                          onChange={(e) => updatePrompt(index, { label: e.target.value })}
                          placeholder={ui("Shown on the button")}
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-muted-foreground">{ui("Message")}</div>
                        <Input
                          className="h-8"
                          value={prompt.message}
                          onChange={(e) => updatePrompt(index, { message: e.target.value })}
                          placeholder={ui("Submitted when clicked")}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mt-5"
                      aria-label={ui("Remove prompt")}
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
                      { id: crypto.randomUUID(), label: ui("New prompt"), message: 'New prompt' },
                    ])
                  }
                >
                  <Plus className="size-3.5" /> {ui("Add prompt")} </Button>
              )}
            </div>
          </>
        )}
      </Section>

      <SaveBar onSave={save} />
    </div>
  )
}
