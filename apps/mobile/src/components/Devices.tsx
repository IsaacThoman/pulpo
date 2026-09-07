import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Button, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { DeviceSession, DeviceSessionList } from '@pulpo/contracts'
import { mobileApi } from '../api/client'
import { useSessionStore } from '../store/session'
import { Card, PageHeader, Screen } from '../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../mockup5/src/theme'

const platforms = { ios: 'iOS', android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux', unknown: 'Unknown platform' }
const apps = { web: 'Web', mobile: 'Mobile app', desktop: 'Desktop app', cli: 'CLI', unknown: 'Unknown app' }

export function DevicesScreen({ navigation }: { navigation: { goBack(): void } }) {
  const theme = useAppTheme()
  const [data, setData] = useState<DeviceSessionList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setData(await mobileApi.sessions()) }
    catch (next) { setError(next instanceof Error ? next.message : 'Could not load devices.') }
    finally { setLoading(false) }
  }, [])
  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh() })
    return () => subscription.remove()
  }, [refresh])
  const revoke = async (session: DeviceSession | 'others') => {
    setBusy(true)
    setError('')
    try {
      if (session === 'others') await mobileApi.revokeOtherSessions()
      else await mobileApi.revokeSession(session.id)
      if (session !== 'others' && session.isCurrent) await useSessionStore.getState().logout(true)
      else await refresh()
    } catch (next) { setError(next instanceof Error ? next.message : 'Could not sign out device.') }
    finally { setBusy(false) }
  }
  const confirm = (session: DeviceSession | 'others') => Alert.alert(
    session === 'others' ? 'Sign out all other devices?' : `Sign out ${session.deviceLabel}?`,
    session !== 'others' && session.isCurrent ? 'This is your current device. You will return to sign-in.' : 'These sessions will need to sign in again.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void revoke(session) } }],
  )
  return <Screen>
    <PageHeader title="Devices" onBack={() => navigation.goBack()} />
    <Text style={{ color: theme.secondary, marginBottom: 12 }}>Each entry is a signed-in session. Different browsers on one device can appear separately.</Text>
    <Button title="Refresh" disabled={loading || busy} onPress={() => void refresh()} />
    <Button title="Sign out all other devices" color={theme.red} disabled={busy || !data?.sessions.some((session) => !session.isCurrent)} onPress={() => confirm('others')} />
    {loading && <ActivityIndicator accessibilityLabel="Loading devices" />}
    {error ? <View accessibilityRole="alert"><Text style={{ color: theme.red }}>{error}</Text><Button title="Retry" disabled={busy} onPress={() => void refresh()} /></View> : null}
    {data?.sessions.length === 0 && <Text style={{ color: theme.secondary }}>No signed-in devices.</Text>}
    {data?.sessions.map((session) => <Card key={session.id} style={{ marginTop: 12 }}>
      <View style={{ padding: 16, gap: 6 }}>
        <Text style={{ color: theme.text, fontWeight: '600' }}>{session.deviceLabel}</Text>
        {session.isCurrent && <Text style={{ color: theme.blue }}>This device</Text>}
        <Text style={{ color: theme.secondary }}>{[apps[session.appType], platforms[session.platform], session.browser].filter(Boolean).join(' · ')}</Text>
        <Text selectable style={{ color: theme.secondary }}>Latest IP: {session.latestIp ?? 'Not yet observed'}</Text>
        <Text style={{ color: theme.secondary }}>Last active: {new Date(session.lastSeenAt).toLocaleString()}</Text>
        <Button title={expanded === session.id ? 'Hide details' : 'Details'} onPress={() => setExpanded(expanded === session.id ? null : session.id)} />
        {expanded === session.id && <View><Text selectable style={{ color: theme.secondary }}>Sign-in IP: {session.signInIp ?? 'Unknown'}</Text><Text style={{ color: theme.secondary }}>Signed in: {new Date(session.createdAt).toLocaleString()}</Text></View>}
        <Button title="Sign out" accessibilityLabel={`Sign out ${session.deviceLabel}`} color={theme.red} disabled={busy} onPress={() => confirm(session)} />
      </View>
    </Card>)}
  </Screen>
}
