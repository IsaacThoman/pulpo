import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Button, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { computerOsLabel, type AgentComputer } from '@pulpo/contracts'
import { listAgentComputers, requestComputerPairing, revokeComputerPairing } from '../features/chat/api'
import { computerCanPair } from '../features/chat/workspacePicker'
import { Card, PageHeader, Screen } from '../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../mockup5/src/theme'

const pairingLabels = { pending: 'Pairing requested · waiting for approval on the computer', approved: 'Paired with this device', denied: 'Pairing denied on the computer', revoked: 'Pairing revoked' }

function computerStatus(computer: AgentComputer): string {
  if (!computer.enabled) return 'Turned off'
  return computer.online ? 'Online' : 'Offline'
}

export function ComputersScreen({ navigation }: { navigation: { goBack(): void } }) {
  const theme = useAppTheme()
  const [data, setData] = useState<{ computers: AgentComputer[]; enabled: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setData(await listAgentComputers()) }
    catch (next) { setError(next instanceof Error ? next.message : 'Could not load computers.') }
    finally { setLoading(false) }
  }, [])
  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh() })
    return () => subscription.remove()
  }, [refresh])
  const pair = async (computer: AgentComputer) => {
    setBusy(computer.id)
    setError('')
    try {
      const { pairing } = await requestComputerPairing(computer.id)
      if (pairing.status === 'pending') Alert.alert('Pairing requested', `Approve this device on ${computer.name} to let the agent work there from this phone.`)
      await refresh()
    } catch (next) { setError(next instanceof Error ? next.message : 'Could not request pairing.') }
    finally { setBusy(null) }
  }
  const revoke = async (computer: AgentComputer) => {
    if (!computer.pairing) return
    setBusy(computer.id)
    setError('')
    try {
      await revokeComputerPairing(computer.id, computer.pairing.id)
      await refresh()
    } catch (next) { setError(next instanceof Error ? next.message : 'Could not remove pairing.') }
    finally { setBusy(null) }
  }
  const confirmRevoke = (computer: AgentComputer) => Alert.alert(
    computer.pairing?.status === 'pending' ? `Cancel pairing with ${computer.name}?` : `Unpair ${computer.name}?`,
    computer.pairing?.status === 'pending' ? 'The request will disappear from that computer.' : 'New chats from this device will use the cloud sandbox until you pair again.',
    [{ text: 'Keep', style: 'cancel' }, { text: computer.pairing?.status === 'pending' ? 'Cancel pairing' : 'Unpair', style: 'destructive', onPress: () => { void revoke(computer) } }],
  )
  return <Screen>
    <PageHeader title="Computers" onBack={() => navigation.goBack()} />
    <Text style={{ color: theme.secondary, marginBottom: 12 }}>Computers running the Pulpo desktop app can host the agent instead of the cloud sandbox. Pair this phone with a computer to pick it as a workspace when you send with the agent.</Text>
    <Button title="Refresh" disabled={loading || busy !== null} onPress={() => void refresh()} />
    {loading && <ActivityIndicator accessibilityLabel="Loading computers" />}
    {error ? <View accessibilityRole="alert"><Text style={{ color: theme.red }}>{error}</Text><Button title="Retry" disabled={busy !== null} onPress={() => void refresh()} /></View> : null}
    {data && !data.enabled && <Text style={{ color: theme.secondary }}>Running the agent on personal computers is turned off for this Pulpo instance.</Text>}
    {data?.enabled && data.computers.length === 0 && <Text style={{ color: theme.secondary }}>No computers yet. Sign in to the Pulpo desktop app and turn on “Let the agent work on this computer”.</Text>}
    {data?.computers.map((computer) => {
      const pairing = computer.pairing
      const canRevoke = Boolean(pairing && (pairing.status === 'pending' || pairing.status === 'approved'))
      return <Card key={computer.id} style={{ marginTop: 12 }}>
        <View style={{ padding: 16, gap: 6 }}>
          <Text style={{ color: theme.text, fontWeight: '600' }}>{computer.name}</Text>
          <Text style={{ color: computer.online && computer.enabled ? theme.green : theme.secondary }}>{computerStatus(computer)}</Text>
          <Text style={{ color: theme.secondary }}>{[computerOsLabel(computer.os), computer.arch, `Pulpo ${computer.appVersion}`].join(' · ')}</Text>
          <Text style={{ color: theme.secondary }}>{computer.accessMode === 'full' ? 'Full access to the computer' : 'Access limited to a folder'}{computer.rootPath ? ` · ${computer.rootPath}` : ''}</Text>
          {pairing
            ? <Text style={{ color: pairing.status === 'approved' ? theme.blue : theme.secondary }}>{pairingLabels[pairing.status]}</Text>
            : <Text style={{ color: theme.secondary }}>{computer.allowRemote ? 'Not paired with this device' : 'Remote use is turned off on this computer'}</Text>}
          {computer.selectable && <Text style={{ color: theme.blue }}>Available as a workspace</Text>}
          {computerCanPair(computer) && <Button title="Pair" accessibilityLabel={`Pair ${computer.name}`} disabled={busy !== null} onPress={() => void pair(computer)} />}
          {canRevoke && <Button title={pairing?.status === 'pending' ? 'Cancel' : 'Unpair'} accessibilityLabel={`${pairing?.status === 'pending' ? 'Cancel pairing with' : 'Unpair'} ${computer.name}`} color={theme.red} disabled={busy !== null} onPress={() => confirmRevoke(computer)} />}
        </View>
      </Card>
    })}
  </Screen>
}
