import { Redirect, Stack } from 'expo-router'
import { useSessionStore } from '@/store/session'

export default function AuthLayout() {
  const status = useSessionStore((state) => state.status)
  if (status === 'authenticated') return <Redirect href="/(member)" />
  return <Stack screenOptions={{ headerShown: false }} />
}
