import { View } from 'react-native'
import { Card, ListRow, NativeSwitch, Screen, SectionTitle } from '@/components/PrototypeUI'
import { SettingsHeader } from '@/features/settings/SettingsComponents'
import { usePreferencesStore } from '@/store/preferences'

export default function InterfaceSettingsScreen() {
  const preferences = usePreferencesStore()
  return <Screen><View style={{ marginHorizontal: -18 }}><SettingsHeader title="Interface" /></View>
    <SectionTitle>Conversation</SectionTitle><Card>
      <ListRow title="Stream responses" detail="Render output as it arrives."><NativeSwitch label="Stream responses" value={preferences.streamResponses} onChange={(value) => { void preferences.setPreference('streamResponses', value) }} /></ListRow>
      <ListRow title="Show reasoning" detail="Show expandable reasoning summaries."><NativeSwitch label="Show reasoning" value={preferences.showReasoning} onChange={(value) => { void preferences.setPreference('showReasoning', value) }} /></ListRow>
      <ListRow title="Haptics" detail="Feedback for sends, menus, and completion." last><NativeSwitch label="Haptics" value={preferences.haptics} onChange={(value) => { void preferences.setPreference('haptics', value) }} /></ListRow>
    </Card>
    <SectionTitle>Offline storage</SectionTitle><Card><ListRow title="Chats kept on device" detail="Recent chat documents cached for search." value={`${preferences.localChatLimit}`} /><ListRow title="Attachment cache" detail="Least recently used files are evicted first." value={`${preferences.attachmentCacheMb} MB`} last /></Card>
  </Screen>
}
