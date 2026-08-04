import { View } from 'react-native'
import { router } from 'expo-router'
import { Form, Section } from '@expo/ui/swift-ui'
import { NativeDestinationRow, SettingsHeader, SettingsNativeHost, settingsStyles } from '@/features/settings/SettingsComponents'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function SettingsScreen() {
  const user = useSessionStore((state) => state.user)!
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const theme = useAppTheme()
  return <View style={[settingsStyles.root, { backgroundColor: theme.background }]}>
    <View style={{ height: 48 }} /><SettingsHeader title="Settings" subtitle="Pulpo for iPhone" />
    <SettingsNativeHost><Form>
      <Section title="Account"><NativeDestinationRow icon="person.crop.circle" title={user.name} detail={user.email} onPress={() => router.push('/(member)/settings/account')} /></Section>
      <Section title="Preferences">
        <NativeDestinationRow icon="paintbrush" title="General" detail="Appearance and keyboard" onPress={() => router.push('/(member)/settings/general')} />
        <NativeDestinationRow icon="text.bubble" title="Interface" detail="Streaming, reasoning, and haptics" onPress={() => router.push('/(member)/settings/interface')} />
        <NativeDestinationRow icon="externaldrive" title="Data and storage" detail="Local cache and file usage" onPress={() => router.push('/(member)/settings/data')} />
      </Section>
      <Section title="Chats"><NativeDestinationRow icon="trash" title="Trash" detail="Restore or permanently remove chats" onPress={() => router.push('/(member)/trash')} /></Section>
      <Section title="Server"><NativeDestinationRow icon="server.rack" title="Pulpo instance" detail={instanceUrl} onPress={() => router.push('/(member)/settings/instance')} /></Section>
    </Form></SettingsNativeHost>
  </View>
}
