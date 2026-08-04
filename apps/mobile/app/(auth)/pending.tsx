import { useEffect, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { AuthShell } from '@/features/auth/AuthShell'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function PendingScreen() {
  const user = useSessionStore((state) => state.user)
  const config = useSessionStore((state) => state.config)
  const logout = useSessionStore((state) => state.logout)
  const refreshSession = useSessionStore((state) => state.refreshSession)
  const theme = useAppTheme()
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    await refreshSession().catch(() => undefined)
    setChecking(false)
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setChecking(true)
        void refreshSession().catch(() => undefined).finally(() => setChecking(false))
      }
    })
    return () => subscription.remove()
  }, [refreshSession])
  return <AuthShell title="Approval needed" subtitle={config?.auth.pendingMessage ?? 'An administrator needs to approve your account before you can start chatting.'}>
    <View style={[styles.card, { backgroundColor: theme.elevated, borderColor: theme.separator }]}>
      <SymbolView name="person.crop.circle.badge.clock" size={28} tintColor={theme.secondary} />
      <View style={{ flex: 1 }}><Text style={[styles.name, { color: theme.text }]}>{user?.name}</Text><Text style={{ color: theme.secondary }}>{user?.email}</Text></View>
    </View>
    {config?.auth.pendingDetails && config.auth.adminEmail ? <Text style={[styles.help, { color: theme.secondary }]}>Contact {config.auth.adminEmail} if you need help.</Text> : null}
    <Pressable accessibilityRole="button" disabled={checking} onPress={() => { void check() }} style={[styles.button, { backgroundColor: theme.accent, opacity: checking ? 0.5 : 1 }]}><Text style={[styles.buttonText, { color: theme.accentText }]}>{checking ? 'Checking…' : 'Check approval'}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => { void logout() }} style={[styles.button, { borderColor: theme.separator }]}><Text style={[styles.buttonText, { color: theme.text }]}>Back to sign in</Text></Pressable>
  </AuthShell>
}

const styles = StyleSheet.create({
  card: { minHeight: 74, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }, name: { fontSize: 16, fontWeight: '600', marginBottom: 2 }, help: { fontSize: 13.5, lineHeight: 20 }, button: { minHeight: 50, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontSize: 16, fontWeight: '600' },
})
