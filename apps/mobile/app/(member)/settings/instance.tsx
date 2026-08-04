import { useMemo, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { router } from 'expo-router'
import { normalizeInstanceUrl } from '@pulpo/client-core'
import { Field, PrimaryButton, Screen, SectionTitle, Card, ListRow } from '@/components/PrototypeUI'
import { SettingsHeader } from '@/features/settings/SettingsComponents'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function InstanceScreen() {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const config = useSessionStore((state) => state.config)
  const switchInstance = useSessionStore((state) => state.switchInstance)
  const theme = useAppTheme()
  const [url, setUrl] = useState(instanceUrl)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const normalizedUrl = useMemo(() => {
    try { return normalizeInstanceUrl(url, typeof __DEV__ !== 'undefined' && __DEV__) }
    catch { return null }
  }, [url])
  const change = () => {
    if (!normalizedUrl) { setError('Enter a valid HTTPS Pulpo instance address.'); return }
    Alert.alert('Switch Pulpo instance?', 'This signs out, removes the Keychain token, and clears all user-scoped caches before connecting to the new server.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Switch instance', style: 'destructive', onPress: () => {
      setLoading(true); setError('')
      void switchInstance(normalizedUrl).then(() => router.replace('/(auth)/login')).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not connect.')).finally(() => setLoading(false))
    } },
    ])
  }
  return <Screen><View style={{ marginHorizontal: -18 }}><SettingsHeader title="Pulpo instance" /></View>
    <SectionTitle>Connected server</SectionTitle><Card><ListRow title={config?.instance.name ?? 'Pulpo'} detail={instanceUrl} value={config?.instance.version ? `v${config.instance.version}` : undefined} last /></Card>
    <SectionTitle>Switch server</SectionTitle><View style={{ gap: 12 }}><Field label="HTTPS instance address" error={!normalizedUrl && url.trim() ? 'Enter a valid HTTPS Pulpo instance address.' : undefined} value={url} onChangeText={(value) => { setUrl(value); setError('') }} autoCapitalize="none" autoCorrect={false} keyboardType="url" />{error ? <Text style={{ color: theme.red, fontSize: 13 }}>{error}</Text> : null}<PrimaryButton label="Connect to another instance" loading={loading} disabled={!normalizedUrl || normalizedUrl === instanceUrl} onPress={change} /></View>
  </Screen>
}
