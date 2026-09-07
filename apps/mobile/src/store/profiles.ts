import { useRealtimeStore } from '../providers/realtimeStore'
import { File } from 'expo-file-system'
import { create } from 'zustand'
import { configureDataProfile, dataProfileScope } from '@pulpo/client-core'
import type { DataProfile, ProfileList } from '@pulpo/contracts'
import { apiRequest } from '../api/client'
import { useSessionStore } from './session'
import { usePreferencesStore } from './preferences'
import { cacheNamespace, clearNamespace, getValue, setValue } from '../data/database'
import { flushCacheWrites } from '../data/writeBehind'
import { mobileComposerSync, clearMobileComposerSync } from '../features/chat/composerSync'
import { clearMobileShelf } from '../features/chat/shelf'
import { clearProductionScope } from '../mockup5/src/production/ProductionBridge'

interface ProfilesState extends ProfileList {
  activeId: string
  owner: string
  ready: boolean
  error: string
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  select: (id: string) => Promise<void>
}
let loading: Promise<void> | undefined
const ownerKey = () => { const { instanceUrl, user } = useSessionStore.getState(); return `${new URL(instanceUrl).origin}|${user?.id ?? ''}` }

async function activate(profileId: string): Promise<void> {
  const { instanceUrl, user } = useSessionStore.getState()
  if (!user) return
  configureDataProfile({ instance: instanceUrl, userId: user.id, profileId })
  await setValue(ownerKey(), 'selected-profile', profileId)
  await usePreferencesStore.getState().hydrate()
}

export const useDataProfiles = create<ProfilesState>((set, get) => ({
  profiles: [], defaultProfileId: '', activeId: '', owner: '', ready: false, error: '',
  bootstrap: () => {
    if (get().ready && get().owner === ownerKey() && dataProfileScope()?.profileId === get().activeId) return Promise.resolve()
    if (loading) return loading
    const owner = ownerKey()
    loading = (async () => {
      set({ ready: false, error: '' })
      const cached = await getValue<ProfileList>(owner, 'data-profiles')
      const list = await apiRequest<ProfileList>('/api/profiles').catch((error) => { if (cached) return cached; throw error })
      if (owner !== ownerKey()) return
      await setValue(owner, 'data-profiles', list)
      const selected = await getValue<string>(owner, 'selected-profile')
      const activeId = list.profiles.some((profile) => profile.id === selected) ? selected! : list.defaultProfileId
      await activate(activeId)
      set({ ...list, activeId, owner, ready: true })
    })().catch((error) => set({ error: error instanceof Error ? error.message : 'Could not load profiles' })).finally(() => { loading = undefined })
    return loading
  },
  refresh: async () => {
    const owner = ownerKey()
    const previous = get().profiles
    const list = await apiRequest<ProfileList>('/api/profiles')
    if (owner !== ownerKey()) return
    await setValue(ownerKey(), 'data-profiles', list)
    set(list)
    if (!list.profiles.some((profile) => profile.id === get().activeId)) await get().select(list.defaultProfileId)
    const userId = useSessionStore.getState().user?.id
    for (const profile of previous) if (!list.profiles.some((item) => item.id === profile.id)) {
      const namespace = `${owner}${profile.id === userId ? '' : `|profile:${profile.id}`}`
      clearMobileComposerSync(namespace); clearMobileShelf(namespace)
      for (const uri of await clearNamespace(namespace)) { try { const file = new File(uri); if (file.exists) file.delete() } catch { /* already removed */ } }
      await clearNamespace(`${owner}|preferences:${profile.id}`)
    }
  },
  select: async (activeId) => {
    if (!get().ready || activeId === get().activeId || !get().profiles.some((profile) => profile.id === activeId)) return
    const scope = dataProfileScope()
    set({ ready: false })
    configureDataProfile(scope)
    if (scope) {
      const namespace = cacheNamespace(scope.instance, scope.userId)
      await mobileComposerSync(namespace)?.pause()
      clearMobileComposerSync(namespace)
      clearMobileShelf(namespace)
      await flushCacheWrites(namespace)
    }
    clearProductionScope()
    useRealtimeStore.getState().resetSnapshots()
    await activate(activeId)
    if (!get().profiles.some((profile) => profile.id === activeId)) { activeId = get().defaultProfileId; await activate(activeId) }
    set({ activeId, ready: true })
  },
}))

export async function saveDataProfile(input: Pick<DataProfile, 'name' | 'color'>, id?: string): Promise<void> {
  const result = await apiRequest<ProfileList & { createdProfileId?: string }>(id ? `/api/profiles/${id}` : '/api/profiles', { method: id ? 'PATCH' : 'POST', body: input })
  useDataProfiles.setState(result)
  await useDataProfiles.getState().refresh()
  if (result.createdProfileId) await useDataProfiles.getState().select(result.createdProfileId)
}

export async function removeDataProfile(profile: DataProfile, name: string): Promise<void> {
  await apiRequest(`/api/profiles/${profile.id}`, { method: 'DELETE', body: { name } })
  await useDataProfiles.getState().refresh()
}
