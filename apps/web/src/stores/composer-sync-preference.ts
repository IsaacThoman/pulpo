import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const STORAGE_KEY = 'pulpo-composer-sync-preference'
interface ComposerSyncPreference {
  enabled: boolean
  /** Retire queued sync checkpoints when opting out; local composer drafts are separate. */
  generation: number
  setEnabled: (enabled: boolean) => void
}

// Browser-local by design: account preference hydration must never override this opt-out.
export const useComposerSyncPreference = create<ComposerSyncPreference>()(persist(
  (set) => ({
    enabled: true,
    generation: 0,
    setEnabled: (enabled) => set((state) => ({
      enabled,
      generation: state.generation + (state.enabled && !enabled ? 1 : 0),
    })),
  }),
  {
    name: STORAGE_KEY,
    storage: createJSONStorage(() => window.localStorage),
    partialize: ({ enabled, generation }) => ({ enabled, generation }),
  },
))

// Apply the browser preference to already-open tabs too.
if (typeof window !== 'undefined') window.addEventListener?.('storage', (event) => {
  if (event.key === STORAGE_KEY) void useComposerSyncPreference.persist.rehydrate()
})
