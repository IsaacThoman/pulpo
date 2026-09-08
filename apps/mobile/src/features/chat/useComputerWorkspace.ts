import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { resolveWorkspace, type WorkspaceSelection } from '@pulpo/contracts'
import { useSessionStore } from '../../store/session'

export function useComputerWorkspace(chatId: string | null | undefined, defaultAgent: boolean) {
  const userId = useSessionStore(state => state.user?.id)
  const instance = useSessionStore(state => state.instanceUrl)
  const key = `workspace:${instance}:${userId}:${chatId ?? 'new'}`
  const [workspace, setWorkspace] = useState<WorkspaceSelection>(resolveWorkspace(undefined, defaultAgent))
  useEffect(() => { let current = true; void AsyncStorage.getItem(key).then(value => { if (current) setWorkspace(value ? JSON.parse(value) as WorkspaceSelection : resolveWorkspace(undefined, defaultAgent)) }); return () => { current = false } }, [key, defaultAgent])
  return { workspace, setWorkspace: (value: WorkspaceSelection) => { setWorkspace(value); void AsyncStorage.setItem(key, JSON.stringify(value)) } }
}
