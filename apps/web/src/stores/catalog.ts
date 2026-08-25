import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Model } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { findCatalogModel } from '@/lib/catalog-model'
import type { CatalogIconReference } from '@/lib/catalog-icons'
import { ui } from '@/i18n/ui'

function emptyModel(): Model {
  return {
    id: '', name: 'Configure a model', providerGroupId: 'internal', provider: 'OpenAI', inferenceProvider: 'Not configured',
    labLogo: 'openai', modelLogo: 'openai', description: ui("An administrator needs to configure an OpenAI model."),
    labCustomIcon: null, modelCustomIcon: null,
    contextWindow: 0, tags: [], iconLight: '#18181b', iconDark: '#fafafa', inputPrice: 0,
    outputPrice: 0, perMessagePrice: 0, enabled: false, agentEnabled: false, presets: [],
  }
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
  customIcon?: CatalogIconReference | null
  iconLight: string | null
  iconDark: string | null
  provider: { id: string; name: string }
  lab: { id: string; name: string; logo: string; customIcon?: CatalogIconReference | null } | null
  presets: Model['presets']
  agentEnabled: boolean
}

function fromServer(model: ServerModel): Model {
  return {
    id: model.id, name: model.name, description: model.description,
    providerGroupId: model.lab?.id ?? 'internal',
    provider: model.lab?.name ?? 'Internal', inferenceProvider: model.provider.name,
    labLogo: model.lab?.logo ?? 'pulpo', modelLogo: model.logo ?? model.lab?.logo ?? 'pulpo',
    labCustomIcon: model.lab?.customIcon ?? null,
    modelCustomIcon: model.customIcon ?? (model.logo ? null : model.lab?.customIcon ?? null),
    contextWindow: model.contextWindow,
    tags: model.tags.filter((tag): tag is Model['tags'][number] => ['vision', 'reasoning', 'tools', 'fast', 'code'].includes(tag)),
    iconLight: model.iconLight ?? '#18181b', iconDark: model.iconDark ?? '#fafafa',
    inputPrice: model.inputPriceMicros / 1_000_000,
    outputPrice: model.outputPriceMicros / 1_000_000,
    perMessagePrice: model.perRequestPriceMicros / 1_000_000,
    enabled: model.enabled, agentEnabled: model.agentEnabled, presets: model.presets,
  }
}

interface CatalogState {
  models: Model[]
  loaded: boolean
  agentAvailable: boolean
  load: () => Promise<void>
}

export const useCatalog = create<CatalogState>()(persist((set) => ({
  models: [],
  loaded: false,
  agentAvailable: false,
  load: async () => {
    try {
      const response = await apiRequest<{ data: ServerModel[]; agentAvailable?: boolean }>('/api/models')
      if (response.data.length) set({ models: response.data.map(fromServer), agentAvailable: response.agentAvailable ?? false, loaded: true })
      else set({ loaded: true })
    } catch {
      // Persisted catalog remains available while offline.
    }
  },
}), { name: 'pulpo-model-catalog', partialize: (state) => ({ models: state.models }) }))

export function getCatalogModel(id: string): Model {
  const models = useCatalog.getState().models
  const model = findCatalogModel(models, id)
  if (model) return model
  if (!id) return models[0] ?? emptyModel()
  if (id === UNKNOWN_MODEL_ID) {
    return {
      ...emptyModel(),
      id,
      name: 'unknown model',
      provider: 'Pulpo',
      inferenceProvider: 'Pulpo',
      labLogo: 'pulpo',
      modelLogo: 'pulpo',
      labCustomIcon: null,
      modelCustomIcon: null,
      description: ui("The original model was deleted from this Pulpo instance."),
    }
  }
  return {
    ...emptyModel(),
    id,
    name: id,
    description: ui("This model is not available in the current catalog."),
  }
}
