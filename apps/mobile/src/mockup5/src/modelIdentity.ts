import type { MobileModel } from '../../types'
import type { PrototypeModel } from './domain'

interface RedirectPreset {
  choices: readonly {
    action: { type: string; modelId?: string }
  }[]
}

export interface RedirectAwareModel {
  id: string
  redirectTargetModelIds?: readonly string[]
}

interface SelectableModel {
  id: string
  enabled?: boolean
}

export function modelSubtitle(model: { lab: string; provider: string }): string {
  return model.lab === model.provider ? model.lab : `${model.lab} · ${model.provider}`
}

/** Keep a new composer on the account default until the user makes an explicit choice. */
export function reconcileComposerModelId<T extends SelectableModel>(
  models: readonly T[],
  selectedModelId: string,
  defaultModelId: string,
  followsDefault: boolean,
): string {
  const available = (model: T) => model.enabled !== false
  const fallback = models.find((model) => model.id === defaultModelId && available(model))
    ?? models.find(available)
    ?? models[0]
  if (followsDefault) return fallback?.id ?? ''
  return models.some((model) => model.id === selectedModelId && available(model))
    ? selectedModelId
    : fallback?.id ?? ''
}

/** Retain the hidden model IDs that a visible model can redirect to. */
export function redirectTargetModelIds(presets: readonly RedirectPreset[]): string[] {
  return [...new Set(presets.flatMap((preset) => preset.choices.flatMap((choice) =>
    choice.action.type === 'redirect' && choice.action.modelId ? [choice.action.modelId] : [],
  )))]
}

function modelFamily(model: MobileModel): 'claude' | 'openai' | 'gemini' | 'deepseek' {
  const value = `${model.provider.name} ${model.name}`.toLowerCase()
  if (value.includes('anthropic') || value.includes('claude')) return 'claude'
  if (value.includes('google') || value.includes('gemini')) return 'gemini'
  if (value.includes('deepseek')) return 'deepseek'
  return 'openai'
}

/** Convert a server catalog model without discarding redirect identity metadata. */
export function mapModel(model: MobileModel, favorites: string[]): PrototypeModel {
  const family = modelFamily(model)
  return {
    id: model.id,
    redirectTargetModelIds: redirectTargetModelIds(model.presets),
    name: model.name,
    providerGroupId: model.lab?.id ?? 'internal',
    provider: model.provider.name,
    lab: model.lab?.name ?? 'Internal',
    description: model.description,
    contextWindow: model.tags.find((tag) => /context/i.test(tag)) ?? `${Math.round(model.maxOutputTokens / 1000)}K max output`,
    pricing: 'Managed by this Pulpo instance',
    tags: model.tags,
    enabled: true,
    agentEnabled: model.agentEnabled,
    favorite: favorites.includes(model.id),
    tint: family === 'claude' ? '#E8794A' : family === 'gemini' ? '#6EA8FF' : family === 'deepseek' ? '#5B8CFF' : '#D9D9D9',
    modelLogo: model.logo ?? model.lab?.logo ?? 'pulpo',
    labLogo: model.lab?.logo ?? 'pulpo',
    modelCustomIcon: model.customIcon ?? (model.logo ? null : model.lab?.customIcon ?? null),
    labCustomIcon: model.lab?.customIcon ?? null,
    presets: model.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      icon: preset.icon,
      selectedId: preset.defaultChoiceId ?? preset.choices[0]?.id ?? '',
      choices: preset.choices.map((option) => ({ id: option.id, label: option.displayName, icon: option.icon ?? preset.icon })),
    })),
  }
}

/** Match web catalog presentation: exact models win, then visible redirect owners. */
export function findDisplayModel<T extends RedirectAwareModel>(models: readonly T[], modelId: string): T | undefined {
  return models.find((model) => model.id === modelId)
    ?? models.find((model) => model.redirectTargetModelIds?.includes(modelId))
}

export function resolveDisplayModel<T extends RedirectAwareModel>(
  models: readonly T[],
  modelId: string,
  unavailable: (modelId: string) => T,
): T {
  return findDisplayModel(models, modelId) ?? unavailable(modelId)
}
