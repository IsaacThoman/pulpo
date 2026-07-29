import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MODELS } from '@/lib/mock'

interface ModelsState {
  favorites: string[]
  toggleFavorite: (id: string) => void
}

export const useModels = create<ModelsState>()(
  persist(
    (set, get) => ({
      favorites: MODELS.filter((m) => m.pinned && m.enabled).map((m) => m.id),
      toggleFavorite: (id) =>
        set({
          favorites: get().favorites.includes(id)
            ? get().favorites.filter((f) => f !== id)
            : [...get().favorites, id],
        }),
    }),
    { name: 'kimi-models' }
  )
)

export const PROVIDERS = [...new Set(MODELS.filter((m) => m.enabled).map((m) => m.provider))]

/** representative model per provider — used for the provider rail colors */
export function providerModel(provider: string) {
  return MODELS.find((m) => m.provider === provider && m.enabled) ?? MODELS[0]
}

/** two-letter monogram to disambiguate same-initial providers */
export function providerMonogram(provider: string): string {
  return provider
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
