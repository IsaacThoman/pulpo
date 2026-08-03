import type { Model } from '@/lib/types'

export function findCatalogModel(models: Model[], modelId: string): Model | undefined {
  const direct = models.find((model) => model.id === modelId)
  if (direct) return direct
  return models.find((model) => model.presets.some((preset) =>
    preset.choices.some((choice) => choice.action.type === 'redirect' && choice.action.modelId === modelId)
  ))
}
