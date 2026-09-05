import { useAppTheme } from '../mockup5/src/theme'
import { useEffect, useState } from 'react'
import { Alert, Button, Linking, Modal, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { apiRequest, mobileApi } from '../api/client'
import { useSessionStore } from '../store/session'
import { cacheNamespace } from '../data/database'

export function DeleteAccountForm({ onClose }: { onClose: () => void }) {
  const theme = useAppTheme()
  const user = useSessionStore((state) => state.user)
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<{ accountDeletionEnabled?: boolean; adminEmail?: string } | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void apiRequest<{ accountDeletionEnabled?: boolean; adminEmail?: string }>('/api/auth/settings')
      .then((value) => { if (active) setSettings(value) })
      .catch(() => { if (active) setError('Could not load account deletion settings.') })
    return () => { active = false }
  }, [])
  const submit = async () => {
    setBusy(true); setError('')
    try {
      await mobileApi.deleteAccount(password, code.trim() || undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete account.')
      setBusy(false)
      return
    }
    const namespace = user ? cacheNamespace(instanceUrl, user.id) : null
    if (namespace) {
      await queryClient.cancelQueries({ predicate: (query) => query.queryKey.includes(namespace) })
      queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(namespace) })
    }
    await useSessionStore.getState().logout(true)
    Alert.alert('Account deletion started', 'Your access has ended. Permanent cleanup and subscription cancellation will continue automatically.')
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}><ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '600', color: theme.text }}>Delete account</Text>
    <Text style={{ color: theme.secondary }}>{user?.email}{'\n'}{instanceUrl}</Text>
    {!settings && !error ? <Text style={{ color: theme.secondary }}>Loading…</Text> : null}
    {settings && !settings.accountDeletionEnabled ? <View style={{ gap: 12 }}>
      <Text style={{ color: theme.secondary }}>{settings.accountDeletionEnabled === false ? 'Account deletion is disabled by the instance administrator.' : 'This server does not support account deletion.'}</Text>
      {settings.adminEmail ? <Button title={settings.adminEmail} onPress={() => { void Linking.openURL(`mailto:${settings.adminEmail}`) }} /> : null}
    </View> : null}
    {settings?.accountDeletionEnabled ? <>
      <Text style={{ color: theme.secondary }}>Deletion is permanent. Your chats, files, memories, and shared links will be removed. Subscriptions will be canceled and unused credits forfeited, with no automatic refunds. Access ends immediately; background cleanup may take time. Backups and payment records follow existing retention policies.</Text>
      <Text style={{ color: theme.text }}>Current password</Text>
      <TextInput accessibilityLabel="Current password" secureTextEntry textContentType="password" autoCapitalize="none" value={password} onChangeText={setPassword} editable={!busy} style={{ borderWidth: 1, borderColor: theme.separator, padding: 12, borderRadius: 8, color: theme.text }} />
      <Text style={{ color: theme.text }}>Authenticator or recovery code (if enabled)</Text>
      <TextInput accessibilityLabel="Authenticator or recovery code (if enabled)" textContentType="oneTimeCode" autoCapitalize="none" autoCorrect={false} value={code} onChangeText={setCode} editable={!busy} style={{ borderWidth: 1, borderColor: theme.separator, padding: 12, borderRadius: 8, color: theme.text }} />
      <Button title={busy ? 'Deleting…' : 'Permanently delete account'} color="#b91c1c" disabled={busy || !password} onPress={() => Alert.alert('Permanently delete account?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void submit() } },
      ])} />
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.red }}>{error}</Text> : null}
    <Button title="Cancel" disabled={busy} onPress={onClose} />
  </ScrollView></SafeAreaView>
}

export function DeleteAccountAction() {
  const [open, setOpen] = useState(false)
  return <>
    <Button title="Delete account" color="#b91c1c" onPress={() => setOpen(true)} />
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      {open ? <DeleteAccountForm onClose={() => setOpen(false)} /> : null}
    </Modal>
  </>
}
