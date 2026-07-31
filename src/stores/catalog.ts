import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Model } from '@/lib/types'
import { MODELS as FALLBACK_MODELS } from '@/lib/mock'
import { apiRequest } from '@/lib/api'

interface ServerModel {
  id: string
  name: string
  description: string
  contextWindow: number
  tags: string[]
  inputPriceMicros: number
  outputPriceMicros: number
  perRequestPriceMicros: number
  enabled: boolean
  iconLight: string | null
  iconDark: string | null
  provider: { name: string }
  lab: { name: string; logo: string } | null
  presets: Model['presets']
}

function fromServer(model: ServerModel): Model {
  return {
    id: model.id, name: model.name, description: model.description,
    provider: model.lab?.name ?? 'OpenAI', inferenceProvider: model.provider.name,
    labLogo: model.lab?.logo ?? 'openai', modelLogo: model.lab?.logo ?? 'openai',
    contextWindow: model.contextWindow,
    tags: model.tags.filter((tag): tag is Model['tags'][number] => ['vision', 'reasoning', 'tools', 'fast', 'code'].includes(tag)),
    iconLight: model.iconLight ?? '#18181b', iconDark: model.iconDark ?? '#fafafa',
    inputPrice: model.inputPriceMicros / 1_000_000,
    outputPrice: model.outputPriceMicros / 1_000_000,
    perMessagePrice: model.perRequestPriceMicros / 1_000_000,
    enabled: model.enabled, presets: model.presets,
  }
}

interface CatalogState {
  models: Model[]
  loaded: boolean
  load: () => Promise<void>
}

export const useCatalog = create<CatalogState>()(persist((set) => ({
  models: FALLBACK_MODELS,
  loaded: false,
  load: async () => {
    try {
      const response = await apiRequest<{ data: ServerModel[] }>('/api/models')
      if (response.data.length) set({ models: response.data.map(fromServer), loaded: true })
      else set({ loaded: true })
    } catch {
      // Persisted catalog remains available while offline.
    }
  },
}), { name: 'pulpo-model-catalog', partialize: (state) => ({ models: state.models }) }))

export function getCatalogModel(id: string): Model {
  const models = useCatalog.getState().models
  return models.find((model) => model.id === id) ?? models[0] ?? FALLBACK_MODELS[0]!
}
