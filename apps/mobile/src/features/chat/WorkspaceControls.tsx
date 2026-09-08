import { useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { type WorkspaceComputer, type WorkspaceSelection, type WorkspaceWait, type ResponseSnapshot } from '@pulpo/contracts'
import { apiRequest } from '../../api/client'
import { useSessionStore } from '../../store/session'
import { useRealtimeStore } from '../../providers/realtimeStore'

export function WorkspacePicker({ value, onChange, disabled }: { value: WorkspaceSelection; onChange(value: WorkspaceSelection): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const userId = useSessionStore(state => state.user?.id)
  const instance = useSessionStore(state => state.instanceUrl)
  const { data } = useQuery({ queryKey: ['workspace-computers', instance, userId], queryFn: () => apiRequest<{ computers: WorkspaceComputer[] }>('/api/me/computers'), enabled: !!userId, refetchInterval: 10_000 })
  const choices = [
    { value: { kind: 'none' } as WorkspaceSelection, label: 'No workspace' }, { value: { kind: 'pulpo' } as WorkspaceSelection, label: 'Pulpo' },
    ...(data?.computers ?? []).flatMap(computer => computer.roots.map(root => ({ value: { kind: 'computer', deviceId: computer.id, rootId: root.id } as WorkspaceSelection, label: `${computer.name} · ${root.path} · ${computer.online ? 'Online' : 'Offline'}` }))),
  ]
  const label = choices.find(choice => JSON.stringify(choice.value) === JSON.stringify(value))?.label ?? 'Computer unavailable'
  return <><Pressable accessibilityRole="button" accessibilityLabel={`Workspace, ${label}`} disabled={disabled} onPress={() => setOpen(true)} style={{ padding: 8, maxWidth: 180 }}><Text numberOfLines={1} style={{ color: '#7373ef' }}>{label} ▾</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }}><View style={{ borderRadius: 16, backgroundColor: '#fff', padding: 20 }}><Text style={{ fontSize: 18, fontWeight: '600' }}>Workspace</Text><ScrollView>{choices.map(choice => <Pressable key={JSON.stringify(choice.value)} accessibilityRole="button" onPress={() => { onChange(choice.value); setOpen(false) }} style={{ paddingVertical: 14 }}><Text>{choice.label}</Text></Pressable>)}</ScrollView><Pressable onPress={() => setOpen(false)}><Text>Cancel</Text></Pressable></View></View></Modal>
  </>
}
export function WorkspaceRecovery({ responseId, wait }: { responseId: string; wait: WorkspaceWait }) {
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
  return <View style={{ marginVertical: 12, padding: 12, borderWidth: 1, borderColor: '#888', borderRadius: 12 }}><Text style={{ color: '#888' }}>{wait.reason === 'capacity' ? 'Waiting for workspace capacity.' : 'The workspace has not responded for 30 seconds.'}</Text>
    <WorkspacePicker value={target} onChange={setTarget} disabled={pending} />
    {(['wait', 'switch', 'none'] as const).map((action, i) => <Pressable key={action} disabled={pending} onPress={() => void recover(action)} style={{ paddingVertical: 8 }}><Text style={{ color: '#7373ef' }}>{['Keep waiting', 'Switch workspace', 'Continue without workspace'][i]}</Text></Pressable>)}
  </View>
}
