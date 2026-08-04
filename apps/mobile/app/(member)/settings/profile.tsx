import { useState } from 'react'
import { View } from 'react-native'
import { mobileApi } from '@/api/client'
import { Field, PrimaryButton, Screen } from '@/components/PrototypeUI'
import { SettingsHeader } from '@/features/settings/SettingsComponents'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function EditProfileScreen() {
  const user = useSessionStore((state) => state.user)!
  const setUser = useSessionStore((state) => state.setUser)
  const theme = useAppTheme()
  const [name, setName] = useState(user.name)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const save = async () => {
    setLoading(true); setMessage('')
    try { const result = await mobileApi.updateProfile(name); await setUser(result.user); setMessage('Profile updated.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not update profile.') }
    finally { setLoading(false) }
  }
  return <Screen scroll={false}><View style={{ marginHorizontal: -18 }}><SettingsHeader title="Edit Profile" /></View><View style={{ gap: 18, paddingTop: 20 }}><Field label="Name" value={name} onChangeText={setName} autoComplete="name" />{message ? <View><Field editable={false} value={message} style={{ color: message === 'Profile updated.' ? theme.green : theme.red }} /></View> : null}<PrimaryButton label="Save changes" loading={loading} disabled={!name.trim() || name.trim() === user.name} onPress={() => { void save() }} /></View></Screen>
}
