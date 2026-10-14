import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { appendMissingOrder, reorderList, resolveOrder } from '@/lib/model-order'
export const CATALOG_PROVIDERS: string[] = []

/** Merge persisted order with catalog so new providers still appear. */
export function resolveProviderOrder(order: string[], available = CATALOG_PROVIDERS) {
  return resolveOrder(order, available)
}

export function resetFavoriteIds(newAccountFavoriteModelIds: string[]): string[] {
  return [...newAccountFavoriteModelIds]
}

interface ModelsState {
  ownerUserId: string | null
  favoriteModelIds: string[]
  /** True while the account has not customized favorites and follows the new-account defaults. */
  favoritesFollowDefaults: boolean
  newAccountFavoriteModelIds: string[]
  newAccountFavoritesLoaded: boolean
  providerOrder: string[]
  toggleFavorite: (id: string) => void
  resetFavorites: () => void
  reorderFavorites: (fromId: string, toId: string, edge: 'before' | 'after') => void
  reorderProviders: (fromId: string, toId: string, edge: 'before' | 'after', available: string[]) => void
}

export const useModels = create<ModelsState>()(
  persist(
    (set, get) => ({
      ownerUserId: null,
      favoriteModelIds: [],
      favoritesFollowDefaults: false,
      newAccountFavoriteModelIds: [],
      newAccountFavoritesLoaded: false,
      providerOrder: [...CATALOG_PROVIDERS],
      toggleFavorite: (id) =>
        set({
          favoriteModelIds: get().favoriteModelIds.includes(id)
            ? get().favoriteModelIds.filter((favoriteId) => favoriteId !== id)
            : [...get().favoriteModelIds, id],
          favoritesFollowDefaults: false,
        }),
      resetFavorites: () => set({
        favoriteModelIds: resetFavoriteIds(get().newAccountFavoriteModelIds),
        favoritesFollowDefaults: true,
      }),
      reorderFavorites: (fromId, toId, edge) =>
        set({ favoriteModelIds: reorderList(get().favoriteModelIds, fromId, toId, edge), favoritesFollowDefaults: false }),
      reorderProviders: (fromId, toId, edge, available) =>
        set({
          providerOrder: reorderList(appendMissingOrder(get().providerOrder, available), fromId, toId, edge),
        }),
    }),
    {
      name: 'pulpo-models',
      partialize: (state) => ({
        ownerUserId: state.ownerUserId,
        favoriteModelIds: state.favoriteModelIds,
        favoritesFollowDefaults: state.favoritesFollowDefaults,
        providerOrder: state.providerOrder,
      }),
    }
  )
)

/** @deprecated use resolveProviderOrder(useModels.getState().providerOrder) */
export const PROVIDERS = CATALOG_PROVIDERS
