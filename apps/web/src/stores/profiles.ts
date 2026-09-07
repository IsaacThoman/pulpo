import { checkpointProfileUploads, restoreProfileUploads } from './upload-outbox'
import { hydrate } from '@tanstack/react-query'
import { clearProfileLocalData, flushQueryPersistence, indexedDbPersister, pauseProfilePersistence } from '@/lib/local-first/database'
import { create } from 'zustand'
import { configureDataProfile, dataProfileScope } from '@pulpo/client-core'
import type { DataProfile, ProfileList } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { isDesktopRuntime, runtimeInstanceUrl } from '@/lib/runtime'
import { useAuth } from './auth'
import { useSettings } from './settings'
import { useModels } from './models'
import { useModelConfig } from './modelConfig'
import { useChat } from './chat'
import { profileStorage } from '@/lib/profile-storage'
import { queryClient } from '@/lib/query-client'
import { pauseWebComposerSync } from '@/lib/local-first/composer-sync'
import { clearWebShelves } from '@/lib/local-first/shelf-registry'

interface ProfilesState extends ProfileList {
  activeId: string
  owner: string
  ready: boolean
  error: string
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  select: (id: string) => Promise<void>
}
let bootstrapPromise: Promise<void> | undefined
const selectionStorage = () => isDesktopRuntime() ? localStorage : sessionStorage
const instance = () => isDesktopRuntime() ? runtimeInstanceUrl() : window.location.origin
const ownerKey = () => `${instance()}:${useAuth.getState().user?.id ?? ''}`

async function activate(id: string): Promise<void> {
  const user = useAuth.getState().user
  if (!user) return
  pauseProfilePersistence(true)
  await flushQueryPersistence()
  configureDataProfile({ instance: instance(), userId: user.id, profileId: id })
  selectionStorage().setItem(`pulpo-selected-profile:${ownerKey()}`, id)
  async function restoreStore<T>(store: { persist: { getOptions(): { name?: string } }; getInitialState(): T; setState(state: T, replace: true): unknown }) {
    const name = store.persist.getOptions().name!
    const serialized = await profileStorage.getItem(name)
    const saved = serialized ? JSON.parse(serialized).state : {}
    store.setState({ ...store.getInitialState(), ...saved }, true)
  }
  await restoreStore(useSettings)
  await restoreStore(useModels)
  await restoreStore(useModelConfig)
  queryClient.clear()
  const cached = await indexedDbPersister.restoreClient()
  if (cached) hydrate(queryClient, cached.clientState)
  await restoreProfileUploads(user.id)
  pauseProfilePersistence(false)
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [], defaultProfileId: '', activeId: '', owner: '', ready: false, error: '',
  bootstrap: () => {
    if (get().ready && get().owner === ownerKey() && dataProfileScope()?.profileId === get().activeId) return Promise.resolve()
    if (bootstrapPromise) return bootstrapPromise
    const owner = ownerKey()
    bootstrapPromise = (async () => {
      set({ ready: false, error: '' })
      const cached = localStorage.getItem(`pulpo-data-profiles:${owner}`)
      const list = await apiRequest<ProfileList>('/api/profiles').catch((error) => {
        if (cached) return JSON.parse(cached) as ProfileList
        throw error
      })
      if (owner !== ownerKey()) return
      localStorage.setItem(`pulpo-data-profiles:${owner}`, JSON.stringify(list))
      const selected = selectionStorage().getItem(`pulpo-selected-profile:${owner}`)
      const activeId = list.profiles.some((profile) => profile.id === selected) ? selected! : list.defaultProfileId
      await activate(activeId)
      set({ ...list, activeId, ready: true, owner })
    })().catch((error) => set({ error: error instanceof Error ? error.message : 'Could not load profiles' })).finally(() => { bootstrapPromise = undefined })
    return bootstrapPromise
  },
  refresh: async () => {
    const owner = ownerKey()
    const previous = get().profiles
    const list = await apiRequest<ProfileList>('/api/profiles')
    if (owner !== ownerKey()) return
    localStorage.setItem(`pulpo-data-profiles:${ownerKey()}`, JSON.stringify(list))
    set(list)
    if (!list.profiles.some((profile) => profile.id === get().activeId)) await get().select(list.defaultProfileId)
    const userId = useAuth.getState().user?.id
    if (userId) for (const profile of previous) if (!list.profiles.some((item) => item.id === profile.id)) await clearProfileLocalData({ instance: instance(), userId, profileId: profile.id })
  },
  select: async (activeId) => {
    if (activeId === get().activeId || !get().profiles.some((profile) => profile.id === activeId)) return
    if (!get().ready) return
    const userId = useAuth.getState().user?.id
    set({ ready: false })
    configureDataProfile(dataProfileScope())
    if (userId) await checkpointProfileUploads(userId)
    pauseProfilePersistence(true)
    await flushQueryPersistence()
    await pauseWebComposerSync()
    clearWebShelves()
    await queryClient.cancelQueries()
    useChat.setState(useChat.getInitialState(), true)
    try { await activate(activeId) } catch (error) {
      pauseProfilePersistence(false)
      set({ error: error instanceof Error ? error.message : 'Could not load profiles' })
      return
    }
    if (!get().profiles.some((profile) => profile.id === activeId)) { activeId = get().defaultProfileId; await activate(activeId) }
    window.history.replaceState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    set({ activeId, ready: true })
  },
}))

export async function saveDataProfile(input: Pick<DataProfile, 'name' | 'color'>, id?: string): Promise<void> {
  const result = await apiRequest<ProfileList & { createdProfileId?: string }>(id ? `/api/profiles/${id}` : '/api/profiles', { method: id ? 'PATCH' : 'POST', body: input })
  useProfiles.setState(result)
  await useProfiles.getState().refresh()
  if (result.createdProfileId) await useProfiles.getState().select(result.createdProfileId)
}

export async function removeDataProfile(profile: DataProfile, name: string): Promise<void> {
  await apiRequest(`/api/profiles/${profile.id}`, { method: 'DELETE', body: { name } })
  await useProfiles.getState().refresh()
}
