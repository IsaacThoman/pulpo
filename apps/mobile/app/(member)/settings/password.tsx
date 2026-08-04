import { useState } from 'react'
import { View } from 'react-native'
import { mobileApi } from '@/api/client'
import { PasswordField, PrimaryButton, Screen } from '@/components/PrototypeUI'
import { SettingsHeader } from '@/features/settings/SettingsComponents'

export default function ChangePasswordScreen() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const save = async () => {
    if (newPassword !== confirm) return setMessage('New passwords do not match.')
    setLoading(true); setMessage('')
    try { await mobileApi.changePassword(currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); setConfirm(''); setMessage('Password changed. Other device sessions remain signed in.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not change password.') }
    finally { setLoading(false) }
  }
  return <Screen scroll={false}><View style={{ marginHorizontal: -18 }}><SettingsHeader title="Change Password" /></View><View style={{ gap: 17, paddingTop: 20 }}><PasswordField label="Current password" value={currentPassword} onChangeText={setCurrentPassword} revealed={revealed} onToggleVisibility={() => setRevealed((value) => !value)} /><PasswordField label="New password" value={newPassword} onChangeText={setNewPassword} revealed={revealed} onToggleVisibility={() => setRevealed((value) => !value)} /><PasswordField label="Confirm new password" value={confirm} onChangeText={setConfirm} revealed={revealed} onToggleVisibility={() => setRevealed((value) => !value)} />{message ? <View><PrimaryButton label={message} variant="plain" disabled onPress={() => undefined} /></View> : null}<PrimaryButton label="Change password" loading={loading} disabled={!currentPassword || newPassword.length < 8 || !confirm} onPress={() => { void save() }} /></View></Screen>
}
