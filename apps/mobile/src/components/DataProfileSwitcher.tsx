import { MaterialButton, MaterialField } from '../platform/MaterialUI'
import { useState } from 'react'
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { DataProfile } from '@pulpo/contracts'
import { useDataProfiles, saveDataProfile, removeDataProfile } from '../store/profiles'
import { useAppTheme } from '../theme'

const colors = ['#6366f1', '#0d9488', '#0284c7', '#d97706', '#e11d48', '#9333ea']

export function DataProfileSwitcher() {
  const theme = useAppTheme()
  const { profiles, activeId, select } = useDataProfiles()
  const active = profiles.find((profile) => profile.id === activeId)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<DataProfile | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DataProfile | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(colors[0]!)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!active) return null
  const badge = (profile: Pick<DataProfile, 'name' | 'color'>) => <View style={[styles.badge, { backgroundColor: profile.color }]}><Text style={styles.initials}>{profile.name.slice(0, 2).toLocaleUpperCase()}</Text></View>
  const edit = (profile: DataProfile | 'new') => { setEditing(profile); setName(profile === 'new' ? '' : profile.name); setColor(profile === 'new' ? colors[0]! : profile.color); setError('') }
  const submit = async () => {
    setBusy(true); setError('')
    try {
      if (deleting) { await removeDataProfile(deleting, confirmation); setDeleting(null) }
      else { await saveDataProfile({ name, color }, editing && editing !== 'new' ? editing.id : undefined); setEditing(null) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save profile') }
    finally { setBusy(false) }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Switch profile: ${active.name}`} onPress={() => setOpen(true)} style={styles.trigger}>{badge(active)}<Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{active.name}</Text><Text style={{ color: theme.secondary }}>⌄</Text></Pressable>
    <Modal visible={open} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} onRequestClose={() => { if (!busy) setOpen(false) }}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={styles.header}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{deleting ? 'Delete profile' : editing ? editing === 'new' ? 'Create profile' : 'Edit profile' : 'Profiles'}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => { if (editing || deleting) { setEditing(null); setDeleting(null) } else setOpen(false) }}><Text style={{ color: theme.blue, fontSize: 17 }}>{editing || deleting ? 'Cancel' : 'Done'}</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={[styles.description, { color: theme.secondary }]}>{deleting ? `Permanently delete ${deleting.name} and its chats, files, drafts, and memories. Type the profile name to confirm.` : editing ? 'Choose a name and color. New profiles start fresh.' : 'Keep chats, files, memories, and settings separate. Your account and billing stay shared.'}</Text>
          {editing || deleting ? <>
            {Platform.OS === 'android' ? <MaterialField label="Profile name" autoFocus maxLength={60} value={deleting ? confirmation : name} onChangeText={deleting ? setConfirmation : setName} /> : <TextInput accessibilityLabel="Profile name" autoFocus maxLength={60} value={deleting ? confirmation : name} onChangeText={deleting ? setConfirmation : setName} placeholder={deleting ? deleting.name : 'Profile name'} placeholderTextColor={theme.secondary} style={[styles.input, { color: theme.text, backgroundColor: theme.elevated, borderColor: theme.separator }]} />}
            {!deleting && <View style={styles.colors}>{colors.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Profile color ${value}`} accessibilityState={{ selected: value === color }} onPress={() => setColor(value)} style={[styles.color, { backgroundColor: value, borderColor: theme.text, borderWidth: value === color ? 3 : 0 }]}>{value === color && <Text style={styles.initials}>✓</Text>}</Pressable>)}</View>}
            {error ? <Text accessibilityRole="alert" style={{ color: theme.red }}>{error}</Text> : null}
            {Platform.OS === 'android' ? <MaterialButton label={deleting ? 'Delete profile' : 'Save'} variant={deleting ? 'destructive' : 'primary'} loading={busy} disabled={deleting ? confirmation !== deleting.name : !name.trim()} onPress={() => void submit()} /> : <Pressable accessibilityRole="button" disabled={busy || (deleting ? confirmation !== deleting.name : !name.trim())} onPress={() => void submit()} style={[styles.save, { backgroundColor: deleting ? theme.red : theme.accent, opacity: busy || (deleting ? confirmation !== deleting.name : !name.trim()) ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color={theme.accentText} /> : <Text style={{ color: deleting ? '#fff' : theme.accentText, fontWeight: '600', fontSize: 17 }}>{deleting ? 'Delete profile' : 'Save'}</Text>}</Pressable>}
          </> : <>
            {profiles.map((profile) => <View key={profile.id} style={[styles.row, { backgroundColor: theme.elevated }]}><Pressable accessibilityRole="button" accessibilityState={{ selected: activeId === profile.id }} onPress={() => { setOpen(false); void select(profile.id) }} style={styles.select}>{badge(profile)}<Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{profile.name}</Text>{profile.id === activeId && <Text style={{ color: theme.blue }}>✓</Text>}</Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${profile.name}`} style={styles.action} onPress={() => edit(profile)}><Text style={{ color: theme.blue }}>Edit</Text></Pressable>{profiles.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${profile.name}`} style={styles.action} onPress={() => { setDeleting(profile); setConfirmation(''); setError('') }}><Text style={{ color: theme.red }}>Delete</Text></Pressable>}</View>)}
            <Pressable accessibilityRole="button" onPress={() => edit('new')} style={[styles.save, { backgroundColor: theme.elevated }]}><Text style={{ color: theme.blue, fontSize: 17, fontWeight: '600' }}>＋ Create profile</Text></Pressable>
          </>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { fontSize: 24, fontWeight: '700' }, content: { padding: 20, paddingTop: 0, gap: 14 }, description: { fontSize: 15, lineHeight: 22, marginBottom: 8 }, trigger: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, maxWidth: 240 }, name: { fontSize: 16, fontWeight: '600', flexShrink: 1 }, badge: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, initials: { color: '#fff', fontSize: 13, fontWeight: '700' }, row: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 12, gap: 6 }, select: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }, action: { padding: 8, minHeight: 44, justifyContent: 'center' }, input: { padding: 16, borderRadius: 14, borderWidth: 1, fontSize: 17 }, colors: { flexDirection: 'row', gap: 12, paddingVertical: 10 }, color: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, save: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
})
