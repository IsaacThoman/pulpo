import { create } from 'zustand'
import type { ApiKey } from '@/lib/types'
import { apiRequest } from '@/lib/api'

interface ServerApiKey {
  id: string
  name: string
  prefix: string
  status: 'active' | 'disabled'
  scopes: ApiKey['scopes']
  allowedModels: string[]
  monthlyBudgetMicros: number | null
  lifetimeBudgetMicros: number | null
  spentThisMonthMicros: number
  spentLifetimeMicros: number
  lastUsedAt: string | null
  createdAt: string
}

function fromServer(key: ServerApiKey): ApiKey {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: Date.parse(key.createdAt),
    lastUsedAt: key.lastUsedAt ? Date.parse(key.lastUsedAt) : null,
    scopes: key.scopes,
    allowedModels: key.allowedModels,
    monthlyBudget: key.monthlyBudgetMicros === null ? null : key.monthlyBudgetMicros / 1_000_000,
    totalBudget: key.lifetimeBudgetMicros === null ? null : key.lifetimeBudgetMicros / 1_000_000,
    spentThisMonth: key.spentThisMonthMicros / 1_000_000,
    spentTotal: key.spentLifetimeMicros / 1_000_000,
    disabled: key.status === 'disabled',
  }
}

interface ApiKeysState {
  keys: ApiKey[]
  loading: boolean
  load: () => Promise<void>
  createKey: (input: Pick<ApiKey, 'name' | 'scopes' | 'allowedModels' | 'monthlyBudget' | 'totalBudget'>) => Promise<{ key: ApiKey; secret: string }>
  setKeyEnabled: (id: string, enabled: boolean) => Promise<void>
  deleteKey: (id: string) => Promise<void>
}

export const useApiKeys = create<ApiKeysState>()((set, get) => ({
  keys: [],
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      const response = await apiRequest<{ data: ServerApiKey[] }>('/api/api-keys')
      set({ keys: response.data.map(fromServer), loading: false })
    } catch {
      set({ loading: false })
    }
  },
  createKey: async (input) => {
    const response = await apiRequest<{ id: string; prefix: string; secret: string }>('/api/api-keys', {
      method: 'POST',
      body: {
        name: input.name,
        scopes: input.scopes,
        allowedModels: input.allowedModels,
        monthlyBudgetMicros: input.monthlyBudget === null ? null : Math.round(input.monthlyBudget * 1_000_000),
        lifetimeBudgetMicros: input.totalBudget === null ? null : Math.round(input.totalBudget * 1_000_000),
      },
    })
    await get().load()
    return { key: get().keys.find((key) => key.id === response.id)!, secret: response.secret }
  },
  setKeyEnabled: async (id, enabled) => {
    const previousKeys = get().keys
    set({ keys: previousKeys.map((key) => key.id === id ? { ...key, disabled: !enabled } : key) })
    try {
      await apiRequest(`/api/api-keys/${id}`, { method: 'PATCH', body: { enabled } })
    } catch (error) {
      set({ keys: previousKeys })
      throw error
    }
  },
  deleteKey: async (id) => {
    set({ keys: get().keys.filter((key) => key.id !== id) })
    await apiRequest(`/api/api-keys/${id}`, { method: 'DELETE' })
  },
}))
