import { Stack } from 'expo-router'
import { AppProviders } from '@/providers/AppProviders'

export default function RootLayout() {
  return <AppProviders>
    <Stack screenOptions={{ headerShown: false, animation: 'default' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(member)" />
      <Stack.Screen name="share/[token]" />
    </Stack>
  </AppProviders>
}
