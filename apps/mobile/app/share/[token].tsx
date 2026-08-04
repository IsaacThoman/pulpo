import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GlassIconButton } from '@/components/PrototypeUI'
import { SafeMarkdown } from '@/components/SafeMarkdown'
import { useAppTheme } from '@/theme'

interface SharedResponse { id: string; input: unknown[]; output: unknown[]; modelId: string }
interface SharedChat { chat: { title: string; modelId: string; createdAt: string }; responses: SharedResponse[] }

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((item) => {
    if (typeof item === 'string') return item
    const part = item as { text?: string; content?: unknown; role?: string; type?: string }
    if (part.role === 'user') return contentText(part.content)
    if (part.type === 'message') return contentText(part.content)
    return part.text ?? ''
  }).join('')
}

export default function SharedChatRoute() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const theme = useAppTheme()
  const [data, setData] = useState<SharedChat | null>(null)
  const [error, setError] = useState('')
  const instance = process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? 'https://pulpo.baby'
  const url = `${instance.replace(/\/+$/, '')}/share/${token}`
  useEffect(() => {
    void fetch(`${instance.replace(/\/+$/, '')}/api/shares/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('This share does not exist or has expired.')
        setData(await response.json() as SharedChat)
      }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open this share.'))
  }, [instance, token])
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
    <View style={styles.header}><GlassIconButton icon="xmark" label="Close" onPress={() => router.replace('/')} /><Text style={[styles.headerTitle, { color: theme.text }]}>Shared Chat</Text><GlassIconButton icon="square.and.arrow.up" label="Share link" onPress={() => { void Share.share({ message: data ? `${data.chat.title}\n${url}` : url, url }) }} /></View>
    {!data && !error ? <View style={styles.center}><ActivityIndicator /></View> : null}
    {error ? <View style={styles.center}><Text style={[styles.errorTitle, { color: theme.text }]}>Link unavailable</Text><Text style={[styles.error, { color: theme.secondary }]}>{error}</Text></View> : null}
    {data ? <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.intro}><Image source={require('../../assets/pulpo-smiley.png')} style={styles.logo} /><Text style={[styles.eyebrow, { color: theme.blue }]}>SHARED FROM PULPO</Text><Text style={[styles.title, { color: theme.text }]}>{data.chat.title}</Text><Text style={[styles.meta, { color: theme.secondary }]}>{data.responses.length * 2} messages · {data.chat.modelId}</Text></View>
      {data.responses.flatMap((response) => [{ id: `${response.id}:input`, role: 'user' as const, text: contentText(response.input) }, { id: response.id, role: 'assistant' as const, text: contentText(response.output) }]).map((message) => <View key={message.id} style={[styles.message, message.role === 'user' && { backgroundColor: theme.elevated, alignSelf: 'flex-end' }]}><Text style={[styles.role, { color: theme.secondary }]}>{message.role === 'user' ? 'You' : 'Pulpo'}</Text>{message.role === 'assistant' ? <SafeMarkdown>{message.text}</SafeMarkdown> : <Text style={[styles.text, { color: theme.text }]}>{message.text}</Text>}</View>)}
      <Text style={[styles.privacy, { color: theme.secondary }]}>This is a public, read-only snapshot. Reasoning is never included in shared chats.</Text>
    </ScrollView> : null}
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { height: 62, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' }, content: { paddingHorizontal: 18, paddingBottom: 40 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 }, errorTitle: { fontSize: 20, fontWeight: '700' }, error: { textAlign: 'center', marginTop: 8, lineHeight: 20 }, intro: { alignItems: 'center', paddingVertical: 30 }, logo: { width: 50, height: 50, borderRadius: 16, marginBottom: 13 }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }, title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center', marginTop: 11 }, meta: { fontSize: 12, marginTop: 6 }, message: { maxWidth: '90%', borderRadius: 19, padding: 13, marginBottom: 16 }, role: { fontSize: 11, fontWeight: '800', marginBottom: 6 }, text: { fontSize: 16, lineHeight: 23 }, privacy: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginVertical: 20 },
})
