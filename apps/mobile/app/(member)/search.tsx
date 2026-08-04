import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/api/client'
import { GlassIconButton } from '@/components/PrototypeUI'
import { cacheNamespace, getValue, searchCachedChats, setValue } from '@/data/database'
import { chatsQuery } from '@/data/queries'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'
import type { ServerChat } from '@/types'

function excerpt(chat: ServerChat, query: string): string {
  const response = chat.responses?.find((item) => JSON.stringify([item.input, item.output]).toLowerCase().includes(query.toLowerCase()))
  const text = response ? JSON.stringify(response.output) : ''
  return text.replace(/[{}[\]"_:,]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

export default function SearchScreen() {
  const theme = useAppTheme()
  const user = useSessionStore((state) => state.user)!
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const namespace = cacheNamespace(instanceUrl, user.id)
  const { data: cached = [] } = useQuery(chatsQuery(namespace))
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [localIds, setLocalIds] = useState<string[]>([])
  const [serverResults, setServerResults] = useState<ServerChat[]>([])
  useEffect(() => { void getValue<string[]>(namespace, 'recentSearches').then((value) => setRecent(value ?? [])) }, [namespace])
  useEffect(() => {
    const value = query.trim()
    if (!value) { setLocalIds([]); setServerResults([]); return }
    const timeout = setTimeout(() => {
      void Promise.all([
        searchCachedChats(namespace, value).catch(() => []),
        apiRequest<{ data: ServerChat[] }>(`/api/chats/search?q=${encodeURIComponent(value)}`).then((result) => result.data).catch(() => []),
      ]).then(([ids, remote]) => { setLocalIds(ids); setServerResults(remote) })
    }, 220)
    return () => clearTimeout(timeout)
  }, [namespace, query])
  const results = useMemo(() => {
    const ids = new Set(localIds)
    const byId = new Map([...cached.filter((chat) => ids.has(chat.id)), ...serverResults].map((chat) => [chat.id, chat]))
    return [...byId.values()]
  }, [cached, localIds, serverResults])
  const open = async (chat: ServerChat) => {
    const value = query.trim()
    if (value) {
      const next = [value, ...recent.filter((item) => item !== value)].slice(0, 8)
      setRecent(next); await setValue(namespace, 'recentSearches', next)
    }
    router.push({ pathname: '/(member)/chat/[id]', params: { id: chat.id } })
  }
  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={styles.top} />
    <View style={styles.header}><GlassIconButton icon="chevron.left" label="Back" onPress={() => router.back()} /><Text style={[styles.title, { color: theme.text }]}>Search</Text><View style={{ width: 44 }} /></View>
    <View style={[styles.search, { backgroundColor: theme.elevated, borderColor: theme.separator }]}><SymbolView name="magnifyingglass" size={17} tintColor={theme.secondary} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search chats and messages…" placeholderTextColor={theme.secondary} style={[styles.input, { color: theme.text }]} />{query ? <Pressable onPress={() => setQuery('')}><SymbolView name="xmark.circle.fill" size={18} tintColor={theme.secondary} /></Pressable> : null}</View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!query.trim() ? <><Text style={[styles.section, { color: theme.secondary }]}>Recent searches</Text>{recent.length ? recent.map((item) => <Pressable key={item} onPress={() => setQuery(item)} style={[styles.row, { borderBottomColor: theme.separator }]}><SymbolView name="clock" size={16} tintColor={theme.secondary} /><Text style={[styles.rowTitle, { color: theme.text }]}>{item}</Text></Pressable>) : <Text style={[styles.empty, { color: theme.secondary }]}>Your recent searches will appear here.</Text>}<Text style={[styles.tip, { color: theme.secondary }]}>Search checks cached chat text instantly and the server’s full-text index when connected.</Text></> : null}
      {query.trim() && !results.length ? <View style={styles.emptyState}><SymbolView name="magnifyingglass" size={30} tintColor={theme.secondary} /><Text style={[styles.emptyTitle, { color: theme.text }]}>No results</Text><Text style={[styles.empty, { color: theme.secondary }]}>Nothing matches “{query.trim()}”.</Text></View> : null}
      {results.map((chat) => <Pressable key={chat.id} onPress={() => { void open(chat) }} style={[styles.result, { borderBottomColor: theme.separator }]}><View style={[styles.resultIcon, { backgroundColor: theme.fillStrong }]}><SymbolView name="bubble.left.and.text.bubble.right" size={17} tintColor={theme.secondary} /></View><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: theme.text }]}>{chat.title}</Text><Text numberOfLines={2} style={[styles.excerpt, { color: theme.secondary }]}>{excerpt(chat, query) || 'Open this chat'}</Text></View><SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} /></Pressable>)}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 }, top: { height: 56 }, header: { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 18, fontWeight: '700' }, search: { minHeight: 48, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, input: { flex: 1, fontSize: 15, paddingVertical: 0 }, content: { paddingBottom: 40 }, section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }, row: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 11 }, rowTitle: { flex: 1, fontSize: 15, fontWeight: '600' }, tip: { fontSize: 12, lineHeight: 18, marginTop: 28 }, empty: { fontSize: 13, lineHeight: 19 }, emptyState: { alignItems: 'center', paddingTop: 80, gap: 9 }, emptyTitle: { fontSize: 18, fontWeight: '700' }, result: { minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 11 }, resultIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, excerpt: { fontSize: 12, lineHeight: 17, marginTop: 3 },
})
