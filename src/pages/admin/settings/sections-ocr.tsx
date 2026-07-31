import { useMemo, useState } from 'react'
import {
  Field,
  NumField,
  SaveBar,
  SecretField,
  Section,
  SelectField,
  TextAreaField,
  TextField,
  Toggle,
} from '@/components/admin/kit'
import { ADMIN_PROVIDERS } from '@/lib/mock-admin'

const CUSTOM = 'custom'

const DEFAULT_PROMPT =
  'convert the image to markdown/latex if applicable, otherwise describe the non-text content part of the image in detail. if there is text present in the image, provide all of the text in the image, unabridged verbatim'

export function OcrSection() {
  const [enabled, setEnabled] = useState(false)
  const [cacheEnabled, setCacheEnabled] = useState(true)
  const [providerId, setProviderId] = useState(CUSTOM)
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyConfigured] = useState(false)
  const [model, setModel] = useState('gpt-4.1-mini')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT)
  const [cacheTtl, setCacheTtl] = useState(3600)

  const isCustom = providerId === CUSTOM
  const selected = useMemo(
    () => (isCustom ? null : ADMIN_PROVIDERS.find((p) => p.id === providerId) ?? null),
    [isCustom, providerId]
  )

  const onProviderChange = (id: string) => {
    setProviderId(id)
    if (id === CUSTOM) return
    const p = ADMIN_PROVIDERS.find((x) => x.id === id)
    if (p) setBaseUrl(p.baseUrl)
    setApiKey('')
  }

  const providerOptions = [
    { value: CUSTOM, label: 'Custom provider for OCR' },
    ...ADMIN_PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
  ]

  return (
    <div>
      <Section title="OCR pipeline" hint="Configure a vision model used to process images before they reach chat models.">
        <Toggle label="Enable OCR pipeline" checked={enabled} onChange={setEnabled} />
        <Toggle
          label="Cache results"
          hint="Reuse OCR output for identical images within the TTL window."
          checked={cacheEnabled}
          onChange={setCacheEnabled}
        />
      </Section>

      <Section title="Provider">
        <SelectField
          label="Provider"
          value={providerId}
          onChange={onProviderChange}
          options={providerOptions}
        />
        {selected && (
          <Field label={selected.name} hint={selected.baseUrl}>
            <span className="text-xs text-muted-foreground">
              {selected.hasApiKey ? 'API key configured' : 'No API key'}
            </span>
          </Field>
        )}
        {isCustom && (
          <>
            <TextField
              label="Base URL"
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://api.openai.com/v1"
              mono
            />
            <SecretField
              label="API key"
              hint={apiKeyConfigured ? 'Configured — leave blank to keep' : undefined}
              value={apiKey}
              onChange={setApiKey}
            />
          </>
        )}
        <TextField
          label="Vision model"
          value={model}
          onChange={setModel}
          placeholder="gpt-4.1-mini"
          mono
        />
      </Section>

      <Section title="Prompt">
        <TextAreaField
          label="System prompt"
          hint="Instructions for how the vision model should turn images into text."
          value={systemPrompt}
          onChange={setSystemPrompt}
          rows={5}
        />
      </Section>

      <Section title="Cache">
        <NumField
          label="Cache TTL"
          hint="How long OCR results are retained."
          value={cacheTtl}
          onChange={setCacheTtl}
          suffix="sec"
        />
      </Section>

      <SaveBar />
    </div>
  )
}
