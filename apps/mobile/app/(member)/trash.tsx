import { Alert, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, mobileApi } from '@/api/client'
import { Card, EmptyState, ListRow, Screen, SectionTitle } from '@/components/PrototypeUI'
import { cacheNamespace } from '@/data/database'
import { queryKeys } from '@/data/queries'
import { permanentlyDeleteChat, restoreChat } from '@/features/chat/api'
import { SettingsHeader } from '@/features/settings/SettingsComponents'
import { useSessionStore } from '@/store/session'

const labels: Record<string, string> = { instant: 'No retention', '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', indefinite: 'Indefinitely' }

export default function TrashScreen() {
  const user = useSessionStore((state) => state.user)!
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const namespace = cacheNamespace(instanceUrl, user.id)
  const queryClient = useQueryClient()
  const { data: deletedResult } = useQuery({ queryKey: queryKeys.deletedChats(namespace), queryFn: mobileApi.deletedChats })
  const { data: settings, refetch: refetchSettings } = useQuery({ queryKey: ['settings', namespace], queryFn: () => apiRequest<{ values: Record<string, unknown> }>('/api/settings') })
  const chats = deletedResult?.data ?? []
  const retention = typeof settings?.values.trashRetention === 'string' ? settings.values.trashRetention : '30d'
  const refetch = () => queryClient.invalidateQueries({ queryKey: queryKeys.deletedChats(namespace) })
  const chooseRetention = () => Alert.alert('Keep trashed chats', 'Chats are permanently removed after this period.', [...Object.entries(labels).map(([value, label]) => ({ text: `${value === retention ? '✓ ' : ''}${label}`, onPress: () => { void apiRequest('/api/settings', { method: 'PATCH', body: { trashRetention: value } }).then(() => refetchSettings()) } })), { text: 'Cancel', style: 'cancel' as const }])
  const actions = (id: string, title: string) => Alert.alert(title, undefined, [
    { text: 'Restore', onPress: () => { void restoreChat(id).then(() => Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })])) } },
    { text: 'Delete permanently', style: 'destructive', onPress: () => Alert.alert('Delete permanently?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void permanentlyDeleteChat(id).then(refetch) } }]) },
    { text: 'Cancel', style: 'cancel' },
  ])
  const empty = () => Alert.alert('Empty Trash?', 'Every trashed chat will be permanently removed. This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete all', style: 'destructive', onPress: () => { void apiRequest('/api/chats/deleted', { method: 'DELETE' }).then(refetch) } }])
  return <Screen><View style={{ marginHorizontal: -18 }}><SettingsHeader title="Trash" subtitle={`${chats.length} recoverable chat${chats.length === 1 ? '' : 's'}`} /></View>
    <SectionTitle>Retention</SectionTitle><Card><ListRow title="Keep trashed chats" detail="Automatic permanent deletion." value={labels[retention] ?? retention} onPress={chooseRetention} last /></Card>
    {chats.length ? <><SectionTitle trailing={<ListRow title="Empty" destructive onPress={empty} last />}>Trashed chats</SectionTitle><Card>{chats.map((chat, index) => <ListRow key={chat.id} icon="bubble.left" title={chat.title} detail={chat.purgeAt ? `Deletes ${new Date(chat.purgeAt).toLocaleDateString()}` : 'Kept indefinitely'} onPress={() => actions(chat.id, chat.title)} last={index === chats.length - 1} />)}</Card></> : <EmptyState icon="trash" title="Trash is empty" detail="Chats you move to Trash will appear here while retention is enabled." />}
  </Screen>
}
