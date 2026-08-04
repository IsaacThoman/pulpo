import { Alert, View } from 'react-native'
import { File } from 'expo-file-system'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/api/client'
import { Card, ListRow, Screen, SectionTitle } from '@/components/PrototypeUI'
import { cacheNamespace, clearDownloadedData } from '@/data/database'
import { queryKeys } from '@/data/queries'
import { SettingsHeader } from '@/features/settings/SettingsComponents'
import { useSessionStore } from '@/store/session'

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export default function DataSettingsScreen() {
  const user = useSessionStore((state) => state.user)!
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const namespace = cacheNamespace(instanceUrl, user.id)
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['attachment-usage', namespace], queryFn: () => apiRequest<{ usedBytes: number; limitBytes: number; remainingBytes: number }>('/api/attachments/usage') })
  const clear = () => Alert.alert('Clear downloaded data?', 'Drafts and the secure sign-in token are kept. Chat and attachment caches will download again as needed.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Clear cache', style: 'destructive', onPress: () => { void clearDownloadedData(namespace).then((uris) => {
      for (const uri of uris) {
        try { const file = new File(uri); if (file.exists) file.delete() } catch { /* already removed */ }
      }
      return queryClient.invalidateQueries()
    }) } },
  ])
  const trashAll = () => Alert.alert('Trash all chats?', 'Your configured trash retention still applies.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Trash all', style: 'destructive', onPress: () => { void apiRequest('/api/chats', { method: 'DELETE' }).then(() => queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })).catch((cause) => Alert.alert('Could not trash chats', cause instanceof Error ? cause.message : undefined)) } },
  ])
  return <Screen><View style={{ marginHorizontal: -18 }}><SettingsHeader title="Data and storage" /></View>
    <SectionTitle>File storage</SectionTitle><Card><ListRow title="Storage used" detail="Uploaded and model-created files." value={data ? `${bytes(data.usedBytes)} of ${bytes(data.limitBytes)}` : 'Loading…'} last /></Card>
    <SectionTitle>On this iPhone</SectionTitle><Card><ListRow icon="externaldrive.badge.xmark" title="Clear downloaded data" detail="Remove cached chat documents and files." destructive onPress={clear} last /></Card>
    <SectionTitle>Danger zone</SectionTitle><Card><ListRow icon="trash" title="Trash all chats" detail="Moves every active chat to Trash." destructive onPress={trashAll} last /></Card>
  </Screen>
}
