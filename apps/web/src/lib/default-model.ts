import type { Model } from '@/lib/types'

export function resolveDefaultModelId(models: Model[], defaultModelId: string): string {
  const saved = models.find((model) => model.id === defaultModelId && model.enabled)
  return saved?.id ?? models.find((model) => model.enabled)?.id ?? models[0]?.id ?? ''
}
