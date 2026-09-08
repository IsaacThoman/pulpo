import { useEffect, useState } from 'react'
import { Alert, Platform, Pressable, Text, View } from 'react-native'
import { Host, Menu, Button, Section } from '@expo/ui/swift-ui'
import { accessibilityHint, accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled as nativeDisabled } from '@expo/ui/swift-ui/modifiers'
import { MaterialMenu } from '../../platform/MaterialUI'
import { useAppTheme } from '../../mockup5/src/theme'
import { useQuery } from '@tanstack/react-query'
import { type WorkspaceComputer, type WorkspaceSelection, type WorkspaceWait, type ResponseSnapshot } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { useSessionStore } from '../../store/session'
import { useRealtimeStore } from '../../providers/realtimeStore'

export function WorkspacePicker({ value, onChange, disabled }: { value: WorkspaceSelection; onChange(value: WorkspaceSelection): void; disabled?: boolean }) {
  const userId = useSessionStore(state => state.user?.id)
  const instance = useSessionStore(state => state.instanceUrl)
  const { data } = useQuery({ queryKey: ['workspace-computers', instance, userId], queryFn: () => apiRequest<{ computers: WorkspaceComputer[] }>('/api/me/computers'), enabled: !!userId, refetchInterval: 10_000 })
  const choices = [
    { value: { kind: 'none' } as WorkspaceSelection, label: 'No workspace', detail: undefined as string | undefined },
    { value: { kind: 'pulpo' } as WorkspaceSelection, label: 'Pulpo', detail: undefined as string | undefined },
    ...(data?.computers ?? []).flatMap(computer => computer.roots.map(root => ({ value: { kind: 'computer', deviceId: computer.id, rootId: root.id } as WorkspaceSelection, label: computer.name, detail: `${root.path} · ${computer.online ? 'Online' : 'Offline'}` }))),
  ]
  const matches = (choice: WorkspaceSelection) => choice.kind === value.kind && (choice.kind !== 'computer' || (value.kind === 'computer' && choice.deviceId === value.deviceId && choice.rootId === value.rootId))
  if (!choices.some(choice => matches(choice.value))) choices.push({ value, label: 'Computer unavailable', detail: undefined })
  const selected = choices.find(choice => matches(choice.value))!
  const label = `Workspace, ${selected.label}${selected.detail ? ` · ${selected.detail}` : ''}`
  if (Platform.OS === 'ios') return <Host ignoreSafeArea="keyboard" matchContents style={{ minHeight: 44, justifyContent: 'center', flexShrink: 1 }}>
    <Menu label={selected.label} modifiers={[buttonStyle('glass'), buttonBorderShape('capsule'), controlSize('regular'), accessibilityLabel(label), accessibilityHint('Opens workspace choices'), nativeDisabled(!!disabled)]}>
      <Section title="Workspace">
        {choices.map(choice => <Button key={JSON.stringify(choice.value)} label={[choice.label, choice.detail].filter(Boolean).join(' · ')} systemImage={matches(choice.value) ? 'checkmark' : undefined} onPress={() => onChange(choice.value)} />)}
      </Section>
    </Menu>
  </Host>
  return <MaterialMenu label={label} text={selected.label} compact icon="chevron.down" disabled={disabled} sections={[{
    id: 'workspace', title: 'Workspace', actions: choices.map(choice => ({
      id: JSON.stringify(choice.value), label: choice.label, detail: choice.detail, selected: matches(choice.value), onPress: () => onChange(choice.value),
    })),
  }]} />
}

export function WorkspaceRecovery({ responseId, wait }: { responseId: string; wait: WorkspaceWait }) {
  const theme = useAppTheme()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const [target, setTarget] = useState<WorkspaceSelection>({ kind: 'pulpo' })
  const [pending, setPending] = useState(false)
  const recover = async (action: 'wait' | 'switch' | 'none', acknowledgeUnknown = false) => {
    if (action !== 'wait' && wait.mayHaveStarted && !acknowledgeUnknown) {
      Alert.alert('Switch workspace?', 'The old command may still run. Local files stay on that computer. Pulpo will continue without replaying the command.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => void recover(action, true) }]); return
    }
    setPending(true)
    try {
      const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${responseId}/workspace-recovery`, { method: 'POST', body: { action, generation: wait.generation, workspace: target, acknowledgeUnknown } })
      useRealtimeStore.getState().receiveSnapshot(snapshot)
    } catch (error) { Alert.alert('Could not recover workspace', error instanceof Error ? error.message : 'Try again') }
    finally { setPending(false) }
  }
  if (wait.reason === 'capacity' && now < Date.parse(wait.startedAt) + 15_000) return null
  return <View style={{ marginVertical: 12, padding: 12, borderWidth: 1, borderColor: theme.separator, borderRadius: 12 }}><Text style={{ color: theme.secondary }}>{wait.reason === 'capacity' ? 'Waiting for workspace capacity.' : 'The workspace has not responded for 30 seconds.'}</Text>
    <WorkspacePicker value={target} onChange={setTarget} disabled={pending} />
    {(['wait', 'switch', 'none'] as const).map((action, i) => <Pressable key={action} disabled={pending} onPress={() => void recover(action)} style={{ paddingVertical: 8 }}><Text style={{ color: theme.accent }}>{['Keep waiting', 'Switch workspace', 'Continue without workspace'][i]}</Text></Pressable>)}
  </View>
}
