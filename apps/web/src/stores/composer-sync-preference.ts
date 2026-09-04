import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useSettings } from './settings'

// Only the checkpoint epoch is local; enabled always comes from account settings.
export const useComposerSyncPreference = create<{
  enabled: boolean
  generation: string
}>()(persist(() => ({ enabled: useSettings.getState().composerSyncEnabled, generation: '' }), {
  name: 'pulpo-composer-sync-epoch',
  storage: createJSONStorage(() => window.localStorage),
  partialize: ({ generation }) => ({ generation }),
}))

useSettings.subscribe((state, previous) => {
  if (state.composerSyncEnabled !== previous.composerSyncEnabled) {
    useComposerSyncPreference.setState({
      enabled: state.composerSyncEnabled,
      ...(!state.composerSyncEnabled ? { generation: crypto.randomUUID() } : {}),
    })
  }
})
