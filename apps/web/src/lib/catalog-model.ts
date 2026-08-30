import type { Model } from '@/lib/types'

export const CODEX_LAB_ID = '00000000-0000-7000-8000-000000000003'

export function findCatalogModel(models: Model[], modelId: string): Model | undefined {
  const direct = models.find((model) => model.id === modelId)
  if (direct) return direct
  return models.find((model) => model.presets.some((preset) =>
    preset.choices.some((choice) => choice.action.type === 'redirect' && choice.action.modelId === modelId)
  ))
}

export function modelSubtitle(model: Pick<Model, 'providerGroupId' | 'provider' | 'inferenceProvider'>): string {
  if (model.providerGroupId === CODEX_LAB_ID) return model.inferenceProvider
  return model.provider === model.inferenceProvider
    ? model.provider
    : `${model.provider} · ${model.inferenceProvider}`
}
