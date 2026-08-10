import { create } from 'zustand'
import { apiRequest } from '@/lib/api'
import type { AdminCatalogIcon } from '@/lib/catalog-icons'

interface CatalogIconState {
  icons: AdminCatalogIcon[]
  loaded: boolean
  load: () => Promise<void>
}

export const useCatalogIcons = create<CatalogIconState>((set) => ({
  icons: [],
  loaded: false,
  load: async () => {
    const result = await apiRequest<{ data: AdminCatalogIcon[] }>('/api/admin/catalog-icons')
    set({ icons: result.data, loaded: true })
  },
}))
