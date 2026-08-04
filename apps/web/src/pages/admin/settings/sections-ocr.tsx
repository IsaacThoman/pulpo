import { useEffect, useMemo, useState } from 'react'
import {
  NumField,
  SaveBar,
  Section,
  SelectField,
  TextAreaField,
  Toggle,
} from '@/components/admin/kit'
import { apiRequest } from '@/lib/api'
import { DEFAULT_OCR_SYSTEM_PROMPT } from '@pulpo/contracts'
import { modelOptionLabel, useAvailableModels } from './use-available-models'

const UNCONFIGURED = '__unconfigured__'

interface OcrSettingsResponse {
  enabled: boolean
  cacheEnabled: boolean
  cacheTtlSeconds: number
  modelId: string | null
  systemPrompt: string
}

export function OcrSection() {
  const models = useAvailableModels()
  const [enabled, setEnabled] = useState(false)
  const [cacheEnabled, setCacheEnabled] = useState(true)
  const [modelId, setModelId] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_OCR_SYSTEM_PROMPT)
  const [cacheTtl, setCacheTtl] = useState(3600)

  useEffect(() => {
    void apiRequest<OcrSettingsResponse>('/api/admin/settings/ocr').then((value) => {
      setEnabled(value.enabled)
      setCacheEnabled(value.cacheEnabled)
      setCacheTtl(value.cacheTtlSeconds)
      setModelId(value.modelId)
      setSystemPrompt(value.systemPrompt)
    })
  }, [])

  const modelOptions = useMemo(() => {
    const sorted = [...models].sort((a, b) => {
      const aVision = a.tags.includes('vision') ? 0 : 1
      const bVision = b.tags.includes('vision') ? 0 : 1
      return aVision - bVision
    })
    const options = [
      { value: UNCONFIGURED, label: 'Select a model' },
      ...sorted.map((model) => ({
        value: model.id,
        label: `${model.tags.includes('vision') ? 'Vision · ' : ''}${modelOptionLabel(model)}`,
      })),
    ]
    if (modelId && !models.some((model) => model.id === modelId)) {
      options.push({ value: modelId, label: `Unavailable (${modelId})` })
    }
    return options
  }, [modelId, models])

  return (
    <div>
      <Section title="OCR pipeline" hint="Configure a catalog model used to process images before they reach chat models.">
        <Toggle label="Enable OCR pipeline" checked={enabled} onChange={setEnabled} />
        <Toggle
          label="Cache results"
          hint="Reuse OCR output for identical images within the TTL window."
          checked={cacheEnabled}
          onChange={setCacheEnabled}
        />
      </Section>

      <Section title="Model" hint="Vision-tagged models are listed first, but any available model can be selected.">
        <SelectField
          label="OCR model"
          hint={enabled && !modelId ? 'A model is required while OCR is enabled.' : undefined}
          value={modelId ?? UNCONFIGURED}
          onChange={(value) => setModelId(value === UNCONFIGURED ? null : value)}
          options={modelOptions}
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

      <SaveBar onSave={async () => {
        if (enabled && !modelId) throw new Error('Select an OCR model before enabling OCR')
        await apiRequest('/api/admin/settings/ocr', {
          method: 'PATCH',
          body: { enabled, cacheEnabled, cacheTtlSeconds: cacheTtl, modelId, systemPrompt },
        })
      }} />
    </div>
  )
}
