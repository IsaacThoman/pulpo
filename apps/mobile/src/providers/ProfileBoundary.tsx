import { useEffect, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useDataProfiles } from '../store/profiles'
import { useSessionStore } from '../store/session'

export function ProfileBoundary({ children }: { children: ReactNode }) {
  const user = useSessionStore((state) => state.user)
  const instance = useSessionStore((state) => state.instanceUrl)
  const { ready, activeId, owner, error, bootstrap } = useDataProfiles()
  useEffect(() => { if (user && user.role !== 'pending') void bootstrap() }, [user, instance, bootstrap])
  if (!user || user.role === 'pending') return children
  if (!ready || owner !== `${new URL(instance).origin}|${user.id}`) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>{error ? <><Text>{error}</Text><Pressable accessibilityRole="button" onPress={() => void bootstrap()}><Text>Retry</Text></Pressable></> : <ActivityIndicator />}</View>
  return <View key={activeId} style={{ flex: 1 }}>{children}</View>
}
