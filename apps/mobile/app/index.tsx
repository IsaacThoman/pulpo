import { ActivityIndicator, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function Index() {
  const status = useSessionStore((state) => state.status)
  const theme = useAppTheme()
  if (status === 'hydrating') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}><ActivityIndicator /></View>
  if (status === 'authenticated') return <Redirect href="/(member)" />
  if (status === 'pending') return <Redirect href="/(auth)/pending" />
  return <Redirect href="/(auth)/login" />
}
