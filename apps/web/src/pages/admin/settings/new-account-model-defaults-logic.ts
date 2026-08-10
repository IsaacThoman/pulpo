import type { NewAccountModelDefaults } from '@pulpo/contracts'
import { modelOptionLabel, type AvailableModel } from './use-available-models'

export const AUTOMATIC_MODEL_VALUE = '__automatic__'
export const ADD_MODEL_VALUE = '__add_model__'

export function moveFavoriteModel(
  favoriteModelIds: string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const target = index + direction
  if (index < 0 || index >= favoriteModelIds.length || target < 0 || target >= favoriteModelIds.length) {
    return favoriteModelIds
  }
  const reordered = [...favoriteModelIds]
  ;[reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!]
  return reordered
}

export function addFavoriteModel(favoriteModelIds: string[], modelId: string): string[] {
  return favoriteModelIds.includes(modelId) ? favoriteModelIds : [...favoriteModelIds, modelId]
}

export function removeFavoriteModel(favoriteModelIds: string[], modelId: string): string[] {
  return favoriteModelIds.filter((candidate) => candidate !== modelId)
}

export function withDefaultModel(
  value: NewAccountModelDefaults,
  defaultModelId: string | null,
): NewAccountModelDefaults {
  return { ...value, defaultModelId }
}

export function defaultModelOptions(models: AvailableModel[], selectedId: string | null) {
  const options = [
    { value: AUTOMATIC_MODEL_VALUE, label: 'Automatic (first available)' },
    ...models.map((model) => ({ value: model.id, label: modelOptionLabel(model) })),
  ]
  if (selectedId && !models.some((model) => model.id === selectedId)) {
    options.push({ value: selectedId, label: `Unavailable (${selectedId})` })
  }
  return options
}
