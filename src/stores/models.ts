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
