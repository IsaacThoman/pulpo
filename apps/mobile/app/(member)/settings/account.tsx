import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import { Button, Form, LabeledContent, Section, Text } from '@expo/ui/swift-ui'
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { NativeDestinationRow, SettingsHeader, SettingsNativeHost, settingsStyles } from '@/features/settings/SettingsComponents'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function AccountScreen() {
  const user = useSessionStore((state) => state.user)!
  const logout = useSessionStore((state) => state.logout)
  const theme = useAppTheme()
  return <View style={[settingsStyles.root, { backgroundColor: theme.background }]}><View style={{ height: 48 }} /><SettingsHeader title="Account" />
    <SettingsNativeHost><Form>
      <Section title="Profile"><LabeledContent label="Name"><Text>{user.name}</Text></LabeledContent><LabeledContent label="Email"><Text modifiers={[foregroundStyle('secondary')]}>{user.email}</Text></LabeledContent><LabeledContent label="Role"><Text modifiers={[foregroundStyle('secondary')]}>{user.role === 'admin' ? 'Administrator' : 'Member'}</Text></LabeledContent><NativeDestinationRow icon="person.crop.circle" title="Edit Profile" onPress={() => router.push('/(member)/settings/profile')} /></Section>
      <Section title="Security"><NativeDestinationRow icon="lock.rotation" title="Change Password" onPress={() => router.push('/(member)/settings/password')} /></Section>
      <Section><Button label="Sign Out" systemImage="rectangle.portrait.and.arrow.right" role="destructive" onPress={() => Alert.alert('Sign out?', 'End this session and clear Pulpo data from this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void logout() } }])} /></Section>
    </Form></SettingsNativeHost>
  </View>
}
