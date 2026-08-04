import { Redirect, Stack } from 'expo-router'
import { useSessionStore } from '@/store/session'

export default function MemberLayout() {
  const status = useSessionStore((state) => state.status)
  if (status === 'pending') return <Redirect href="/(auth)/pending" />
  if (status !== 'authenticated') return <Redirect href="/(auth)/login" />
  return <Stack screenOptions={{ headerShown: false }} />
}
