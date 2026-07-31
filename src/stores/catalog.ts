import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Model } from '@/lib/types'
import { apiRequest } from '@/lib/api'

const EMPTY_MODEL: Model = {
  id: '', name: 'Configure a model', provider: 'OpenAI', inferenceProvider: 'Not configured',
  labLogo: 'openai', modelLogo: 'openai', description: 'An administrator needs to configure an OpenAI model.',
  contextWindow: 0, tags: [], iconLight: '#18181b', iconDark: '#fafafa', inputPrice: 0,
  outputPrice: 0, perMessagePrice: 0, enabled: false, presets: [],
}

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
  visible: boolean
  logo: string | null
  iconLight: string | null
  iconDark: string | null
  provider: { name: string }
  lab: { name: string; logo: string } | null
  presets: Model['presets']
}

function fromServer(model: ServerModel): Model {
  return {
    id: model.id, name: model.name, description: model.description,
    provider: model.lab?.name ?? 'Internal', inferenceProvider: model.provider.name,
    labLogo: model.lab?.logo ?? 'pulpo', modelLogo: model.logo ?? model.lab?.logo ?? 'pulpo',
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
  models: [],
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
  return models.find((model) => model.id === id) ?? models[0] ?? EMPTY_MODEL
}
