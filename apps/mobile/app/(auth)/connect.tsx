import { useState } from 'react'
import { Text } from 'react-native'
import { router } from 'expo-router'
import { AuthButton, AuthError, AuthField, AuthLink, AuthShell, authStyles } from '@/features/auth/AuthShell'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function ConnectScreen() {
  const current = useSessionStore((state) => state.instanceUrl)
  const switchInstance = useSessionStore((state) => state.switchInstance)
  const theme = useAppTheme()
  const [url, setUrl] = useState(current)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true); setError('')
    try { await switchInstance(url); router.replace('/(auth)/login') } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to this Pulpo instance.')
    } finally { setLoading(false) }
  }
  return <AuthShell title="Connect to Pulpo" subtitle="Use the address of your organization’s Pulpo instance. Your conversations stay on that server.">
    <AuthField icon="network" label="Pulpo instance address" invalid={Boolean(error)} value={url} onChangeText={setUrl} autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={() => { void submit() }} />
    <AuthError>{error}</AuthError>
    <AuthButton label="Continue" loading={loading} disabled={!url.trim()} icon="arrow.right" onPress={() => { void submit() }} />
    <Text style={[authStyles.note, { color: theme.tertiary }]}>HTTPS is required for production instances. Local HTTP is available in development builds.</Text>
    <AuthLink label="Back to sign in" onPress={() => router.back()} />
  </AuthShell>
}
