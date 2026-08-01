import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { reorderList, resolveOrder } from '@/lib/model-order'
export const CATALOG_PROVIDERS: string[] = []

/** Merge persisted order with catalog so new providers still appear. */
export function resolveProviderOrder(order: string[], available = CATALOG_PROVIDERS) {
  return resolveOrder(order, available)
}

interface ModelsState {
  favorites: string[]
  providers: string[]
  toggleFavorite: (id: string) => void
  reorderFavorites: (fromId: string, toId: string, edge: 'before' | 'after') => void
  reorderProviders: (fromId: string, toId: string, edge: 'before' | 'after', available: string[]) => void
}

export const useModels = create<ModelsState>()(
  persist(
    (set, get) => ({
      favorites: [],
      providers: [...CATALOG_PROVIDERS],
      toggleFavorite: (id) =>
        set({
          favorites: get().favorites.includes(id)
            ? get().favorites.filter((f) => f !== id)
            : [...get().favorites, id],
        }),
      reorderFavorites: (fromId, toId, edge) =>
        set({ favorites: reorderList(get().favorites, fromId, toId, edge) }),
      reorderProviders: (fromId, toId, edge, available) =>
        set({
          providers: reorderList(resolveProviderOrder(get().providers, available), fromId, toId, edge),
        }),
    }),
    { name: 'pulpo-models' }
  )
)

/** @deprecated use resolveProviderOrder(useModels.getState().providers) */
export const PROVIDERS = CATALOG_PROVIDERS
