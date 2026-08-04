import { View } from 'react-native'
import { Card, ListRow, NativeSwitch, Screen, SectionTitle, Segmented } from '@/components/PrototypeUI'
import { SettingsHeader } from '@/features/settings/SettingsComponents'
import { usePreferencesStore } from '@/store/preferences'

export default function GeneralSettingsScreen() {
  const theme = usePreferencesStore((state) => state.theme)
  const textSize = usePreferencesStore((state) => state.textSize)
  const sendWithEnter = usePreferencesStore((state) => state.sendWithEnter)
  const setPreference = usePreferencesStore((state) => state.setPreference)
  return <Screen><View style={{ marginHorizontal: -18 }}><SettingsHeader title="General" /></View>
    <SectionTitle>Appearance</SectionTitle><Card><ListRow title="Theme" detail="Follow iOS or choose a fixed appearance."><View style={{ width: 190 }}><Segmented options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const} value={theme} onChange={(value) => { void setPreference('theme', value) }} /></View></ListRow><ListRow title="Text size" detail="In-app conversation text." last><View style={{ width: 190 }}><Segmented options={[{ value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }, { value: 'extra-large', label: 'XL' }] as const} value={textSize} onChange={(value) => { void setPreference('textSize', value) }} /></View></ListRow></Card>
    <SectionTitle>Keyboard</SectionTitle><Card><ListRow title="Send with Enter" detail="Applies to a connected hardware keyboard." last><NativeSwitch label="Send with Enter" value={sendWithEnter} onChange={(value) => { void setPreference('sendWithEnter', value) }} /></ListRow></Card>
  </Screen>
}
