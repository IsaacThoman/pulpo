import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MODELS } from '@/lib/mock'

export const CATALOG_PROVIDERS = [
  ...new Set(MODELS.filter((m) => m.enabled).map((m) => m.provider)),
]

function reorderList(
  list: string[],
  fromId: string,
  toId: string,
  edge: 'before' | 'after'
) {
  if (fromId === toId) return list
  const next = [...list]
  const from = next.indexOf(fromId)
  if (from < 0 || next.indexOf(toId) < 0) return list
  next.splice(from, 1)
  const to = next.indexOf(toId)
  next.splice(edge === 'before' ? to : to + 1, 0, fromId)
  return next
}

/** Merge persisted order with catalog so new providers still appear. */
export function resolveProviderOrder(order: string[]) {
  const known = new Set(CATALOG_PROVIDERS)
  const ordered = order.filter((p) => known.has(p))
  for (const p of CATALOG_PROVIDERS) {
    if (!ordered.includes(p)) ordered.push(p)
  }
  return ordered
}

interface ModelsState {
  favorites: string[]
  providers: string[]
  toggleFavorite: (id: string) => void
  reorderFavorites: (fromId: string, toId: string, edge: 'before' | 'after') => void
  reorderProviders: (fromId: string, toId: string, edge: 'before' | 'after') => void
}

export const useModels = create<ModelsState>()(
  persist(
    (set, get) => ({
      favorites: MODELS.filter((m) => m.pinned && m.enabled).map((m) => m.id),
      providers: [...CATALOG_PROVIDERS],
      toggleFavorite: (id) =>
        set({
          favorites: get().favorites.includes(id)
            ? get().favorites.filter((f) => f !== id)
            : [...get().favorites, id],
        }),
      reorderFavorites: (fromId, toId, edge) =>
        set({ favorites: reorderList(get().favorites, fromId, toId, edge) }),
      reorderProviders: (fromId, toId, edge) =>
        set({
          providers: reorderList(resolveProviderOrder(get().providers), fromId, toId, edge),
        }),
    }),
    { name: 'pulpo-models' }
  )
)

/** @deprecated use resolveProviderOrder(useModels.getState().providers) */
export const PROVIDERS = CATALOG_PROVIDERS
