import { useMemo, useState } from 'react'
import { Alert, Image, Platform, Pressable, SectionList, Share, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import * as Crypto from 'expo-crypto'
import * as Haptics from 'expo-haptics'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeContextMenu, type ContextAction } from '@/components/NativeContextMenu'
import { GlassIconButton } from '@/components/PrototypeUI'
import { ApiError, apiRequest, isNetworkError } from '@/api/client'
import { cacheNamespace } from '@/data/database'
import { queueOfflineMutation } from '@/data/mutations'
import { chatsQuery, foldersQuery, mergeChatSummary, queryKeys } from '@/data/queries'
import { createFolder, deleteFolder, duplicateChat, shareChat, trashChat, updateChat, updateFolder } from '@/features/chat/api'
import { useRealtimeStore } from '@/providers/realtimeStore'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'
import type { ServerChat, ServerFolder } from '@/types'

function relativeTime(value: string): string {
  const delta = Date.now() - Date.parse(value)
  if (delta < 60_000) return 'now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`
  return `${Math.floor(delta / 86_400_000)}d`
}

function dateSection(chat: ServerChat): string {
  if (chat.pinned) return 'Pinned'
  const days = (Date.now() - Date.parse(chat.updatedAt)) / 86_400_000
  return days < 1 ? 'Today' : days < 7 ? 'Previous 7 days' : 'Earlier'
}

export default function ChatHistoryScreen() {
  const theme = useAppTheme()
  const user = useSessionStore((state) => state.user)!
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const namespace = cacheNamespace(instanceUrl, user.id)
  const queryClient = useQueryClient()
  const { data: chats = [], isLoading, error } = useQuery(chatsQuery(namespace))
  const syncError = useRealtimeStore((state) => state.syncError)
  const { data: folders = [] } = useQuery(foldersQuery(namespace))
  const [foldersExpanded, setFoldersExpanded] = useState(true)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const filtered = useMemo(() => chats.filter((chat) => !chat.folderId), [chats])
  const sections = useMemo(() => ['Pinned', 'Today', 'Previous 7 days', 'Earlier'].flatMap((title) => {
    const data = filtered.filter((chat) => dateSection(chat) === title)
    return data.length ? [{ title, data }] : []
  }), [filtered])

  const commitChat = (chat: ServerChat) => queryClient.setQueryData<ServerChat[]>(queryKeys.chats(namespace), (current = []) => mergeChatSummary(current, chat))
  const removeChat = (id: string) => queryClient.setQueryData<ServerChat[]>(queryKeys.chats(namespace), (current = []) => current.filter((chat) => chat.id !== id))
  const metadata = async (chat: ServerChat, patch: Partial<Pick<ServerChat, 'title' | 'pinned' | 'folderId'>>) => {
    commitChat({ ...chat, ...patch, updatedAt: new Date().toISOString() })
    try { commitChat(await updateChat(chat.id, patch)) } catch (cause) {
      if (isNetworkError(cause)) await queueOfflineMutation({ namespace, entityKey: `chat:${chat.id}`, method: 'PATCH', path: `/api/chats/${chat.id}`, body: patch })
      else { await queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) }); Alert.alert('Could not update chat', cause instanceof Error ? cause.message : undefined) }
    }
  }
  const confirmTrash = (chat: ServerChat) => Alert.alert('Move to Trash?', `“${chat.title}” can be restored from Settings.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Move to Trash', style: 'destructive', onPress: () => {
      removeChat(chat.id)
      void trashChat(chat.id).catch(async (cause) => {
        if (isNetworkError(cause)) await queueOfflineMutation({ namespace, entityKey: `chat:${chat.id}`, method: 'DELETE', path: `/api/chats/${chat.id}` })
        else void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
      })
    } },
  ])
  const move = (chat: ServerChat) => Alert.alert('Move to folder', chat.title, [
    { text: 'No folder', onPress: () => { void metadata(chat, { folderId: null }) } },
    ...folders.map((folder) => ({ text: folder.name, onPress: () => { void metadata(chat, { folderId: folder.id }) } })),
    { text: 'Cancel', style: 'cancel' as const },
  ])
  const rename = (chat: ServerChat) => Platform.OS === 'ios' && Alert.prompt('Rename chat', undefined, (title) => {
    if (title.trim()) void metadata(chat, { title: title.trim() })
  }, 'plain-text', chat.title)
  const share = async (chat: ServerChat) => {
    try { const url = await shareChat(chat.id); await Share.share({ title: chat.title, message: `${chat.title}\n${url}`, url }) }
    catch (cause) { Alert.alert('Could not share chat', cause instanceof Error ? cause.message : undefined) }
  }
  const duplicate = async (chat: ServerChat) => {
    try { const copy = await duplicateChat(chat.id); commitChat(copy); router.push({ pathname: '/(member)/chat/[id]', params: { id: copy.id } }) }
    catch (cause) { Alert.alert('Could not duplicate chat', cause instanceof Error ? cause.message : undefined) }
  }
  const actionsFor = (chat: ServerChat): Array<ContextAction | 'divider'> => [
    { label: 'Share', systemImage: 'square.and.arrow.up', grouped: true, onPress: () => { void share(chat) } },
    { label: 'Move', systemImage: 'folder', grouped: true, onPress: () => move(chat) },
    { label: 'Trash', systemImage: 'trash', destructive: true, grouped: true, onPress: () => confirmTrash(chat) },
    'divider',
    { label: chat.pinned ? 'Unpin chat' : 'Pin chat', systemImage: chat.pinned ? 'pin.slash' : 'pin', onPress: () => { void metadata(chat, { pinned: !chat.pinned }) } },
    { label: 'Rename chat', systemImage: 'pencil', onPress: () => rename(chat) },
    { label: 'Duplicate chat', systemImage: 'plus.square.on.square', onPress: () => { void duplicate(chat) } },
  ]
  const fallbackActions = (chat: ServerChat) => Alert.alert(chat.title, undefined, [
    { text: 'Rename', onPress: () => rename(chat) }, { text: 'Share', onPress: () => { void share(chat) } },
    { text: 'Move to Trash', style: 'destructive', onPress: () => confirmTrash(chat) }, { text: 'Cancel', style: 'cancel' },
  ])
  const addFolder = () => Platform.OS === 'ios' && Alert.prompt('New folder', 'Create a folder for related chats.', (name) => {
    if (!name.trim()) return
    const id = Crypto.randomUUID()
    const now = new Date().toISOString()
    const optimistic: ServerFolder = { id, name: name.trim(), pinned: false, sortOrder: folders.length, createdAt: now, updatedAt: now }
    queryClient.setQueryData<ServerFolder[]>(queryKeys.folders(namespace), (current = []) => [...current, optimistic])
    void createFolder(name.trim(), id).then((created) => queryClient.setQueryData<ServerFolder[]>(queryKeys.folders(namespace), (current = []) => current.map((folder) => folder.id === id ? created : folder)))
      .catch(async (cause) => {
        if (isNetworkError(cause)) await queueOfflineMutation({ namespace, entityKey: `folder:${id}`, method: 'POST', path: '/api/folders', body: { clientId: id, name: name.trim() } })
        else { await queryClient.invalidateQueries({ queryKey: queryKeys.folders(namespace) }); Alert.alert('Could not create folder', cause instanceof Error ? cause.message : undefined) }
      })
  })
  const folderMetadata = async (folder: ServerFolder, patch: Partial<Pick<ServerFolder, 'name' | 'pinned' | 'sortOrder'>>) => {
    queryClient.setQueryData<ServerFolder[]>(queryKeys.folders(namespace), (current = []) => current.map((item) => item.id === folder.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item))
    try {
      const updated = await updateFolder(folder.id, patch)
      queryClient.setQueryData<ServerFolder[]>(queryKeys.folders(namespace), (current = []) => current.map((item) => item.id === folder.id ? updated : item))
    } catch (cause) {
      if (isNetworkError(cause)) await queueOfflineMutation({ namespace, entityKey: `folder:${folder.id}`, method: 'PATCH', path: `/api/folders/${folder.id}`, body: patch })
      else await queryClient.invalidateQueries({ queryKey: queryKeys.folders(namespace) })
    }
  }
  const reorderFolder = async (folder: ServerFolder, offset: -1 | 1) => {
    const ordered = [...folders].sort((left, right) => left.sortOrder - right.sortOrder)
    const index = ordered.findIndex((item) => item.id === folder.id)
    const destination = index + offset
    if (index < 0 || destination < 0 || destination >= ordered.length) return
    const [moved] = ordered.splice(index, 1)
    if (!moved) return
    ordered.splice(destination, 0, moved)
    const next = ordered.map((item, sortOrder) => ({ ...item, sortOrder }))
    queryClient.setQueryData(queryKeys.folders(namespace), next)
    const body = { folderIds: next.map((item) => item.id) }
    try { await apiRequest('/api/folders/order', { method: 'PUT', body }) }
    catch (cause) {
      if (isNetworkError(cause)) await queueOfflineMutation({ namespace, entityKey: 'folder:order', method: 'PUT', path: '/api/folders/order', body })
      else await queryClient.invalidateQueries({ queryKey: queryKeys.folders(namespace) })
    }
  }
  const removeFolder = async (folder: ServerFolder) => {
    queryClient.setQueryData<ServerFolder[]>(queryKeys.folders(namespace), (current = []) => current.filter((item) => item.id !== folder.id))
    queryClient.setQueryData<ServerChat[]>(queryKeys.chats(namespace), (current = []) => current.map((chat) => chat.folderId === folder.id ? { ...chat, folderId: null } : chat))
    try { await deleteFolder(folder.id) }
    catch (cause) {
      if (isNetworkError(cause)) await queueOfflineMutation({ namespace, entityKey: `folder:${folder.id}`, method: 'DELETE', path: `/api/folders/${folder.id}` })
      else await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.folders(namespace) }), queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })])
    }
  }
  const editFolder = (folder: ServerFolder) => Alert.alert(folder.name, undefined, [
    { text: folder.pinned ? 'Unpin' : 'Pin', onPress: () => { void folderMetadata(folder, { pinned: !folder.pinned }) } },
    { text: 'Rename', onPress: () => Platform.OS === 'ios' && Alert.prompt('Rename folder', undefined, (name) => name.trim() && void folderMetadata(folder, { name: name.trim() }), 'plain-text', folder.name) },
    { text: 'Move up', onPress: () => { void reorderFolder(folder, -1) } },
    { text: 'Move down', onPress: () => { void reorderFolder(folder, 1) } },
    { text: 'Delete folder', style: 'destructive', onPress: () => { void removeFolder(folder) } },
    { text: 'Cancel', style: 'cancel' },
  ])

  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={styles.safeTop} />
    <View style={styles.header}>
      <View style={styles.profile}><Image source={require('../../assets/pulpo-smiley.png')} style={styles.logo} /><Text style={[styles.brand, { color: theme.text }]}>Pulpo</Text></View>
      <GlassIconButton icon="gearshape" label="Settings" onPress={() => router.push('/(member)/settings')} />
    </View>
    <Pressable accessibilityRole="search" onPress={() => router.push('/(member)/search')} style={[styles.search, { backgroundColor: theme.fillStrong }]}>
      <SymbolView name="magnifyingglass" size={17} tintColor={theme.secondary} /><Text style={[styles.searchPlaceholder, { color: theme.secondary }]}>Search chats and messages</Text>
    </Pressable>
    <Pressable onPress={() => router.push('/(member)/chat/new')} style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.fill }]}>
      <SymbolView name="square.and.pencil" size={18} tintColor={theme.text} /><Text style={[styles.actionText, { color: theme.text }]}>New chat</Text>
    </Pressable>
    <Pressable onPress={() => setFoldersExpanded((current) => !current)} onLongPress={addFolder} style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.fill }]}>
      <SymbolView name={foldersExpanded ? 'folder.fill' : 'folder'} size={18} tintColor={theme.text} /><Text style={[styles.actionText, { color: theme.text }]}>Folders</Text><Text style={{ color: theme.secondary }}>{folders.length}</Text>
    </Pressable>
    {foldersExpanded ? <View style={styles.folderList}>{folders.map((folder) => {
      const folderChats = chats.filter((chat) => chat.folderId === folder.id)
      const expanded = expandedFolders[folder.id] ?? false
      return <View key={folder.id}>
        <Pressable onPress={() => setExpandedFolders((current) => ({ ...current, [folder.id]: !expanded }))} onLongPress={() => editFolder(folder)} style={styles.folderRow}>
          <SymbolView name={expanded ? 'folder.fill' : 'folder'} size={15} tintColor={theme.secondary} /><Text numberOfLines={1} style={[styles.folderTitle, { color: theme.text }]}>{folder.name}</Text><Text style={{ color: theme.secondary }}>{folderChats.length}</Text>
        </Pressable>
        {expanded ? folderChats.map((chat) => <Pressable key={chat.id} onPress={() => router.push({ pathname: '/(member)/chat/[id]', params: { id: chat.id } })} style={styles.folderChat}><SymbolView name="bubble.left" size={13} tintColor={theme.secondary} /><Text numberOfLines={1} style={[styles.folderTitle, { color: theme.text }]}>{chat.title}</Text></Pressable>) : null}
      </View>
    })}<Pressable onPress={addFolder} style={styles.folderRow}><SymbolView name="folder.badge.plus" size={15} tintColor={theme.secondary} /><Text style={[styles.folderTitle, { color: theme.secondary }]}>New folder</Text></Pressable></View> : null}
    {error ? <Text style={[styles.error, { color: theme.red }]}>{error instanceof ApiError ? error.message : 'Could not load chats'}</Text> : null}
    {syncError ? <Pressable accessibilityRole="alert" onPress={() => useRealtimeStore.getState().setSyncError(null)} style={[styles.syncError, { backgroundColor: theme.elevated2 }]}><SymbolView name="exclamationmark.triangle.fill" size={15} tintColor={theme.orange} /><Text style={[styles.syncErrorText, { color: theme.text }]}>{syncError}</Text><SymbolView name="xmark" size={11} tintColor={theme.secondary} /></Pressable> : null}
    <SectionList
      sections={sections}
      keyExtractor={(chat) => chat.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.list}
      ListEmptyComponent={!isLoading ? <Text style={[styles.empty, { color: theme.secondary }]}>Start a new chat with Pulpo.</Text> : null}
      renderSectionHeader={({ section }) => <Text style={[styles.section, { color: theme.secondary }]}>{section.title}</Text>}
      renderItem={({ item: chat }) => <NativeContextMenu actions={actionsFor(chat)} preview={<View style={[styles.preview, { backgroundColor: theme.elevated }]}><Image source={require('../../assets/pulpo-smiley.png')} style={styles.previewLogo} /><Text style={[styles.previewTitle, { color: theme.text }]}>{chat.title}</Text><Text style={{ color: theme.secondary }}>{relativeTime(chat.updatedAt)} ago</Text></View>}>
        <Pressable accessibilityHint="Long press for chat actions" onLongPress={() => Platform.OS !== 'ios' && fallbackActions(chat)} onPress={() => { void Haptics.selectionAsync(); router.push({ pathname: '/(member)/chat/[id]', params: { id: chat.id } }) }} style={({ pressed }) => [styles.chatRow, pressed && { backgroundColor: theme.fill }]}>
          {chat.pinned ? <SymbolView name="pin.fill" size={12} tintColor={theme.secondary} /> : null}<Text numberOfLines={1} style={[styles.chatTitle, { color: theme.text }]}>{chat.title}</Text><Text style={[styles.time, { color: theme.secondary }]}>{relativeTime(chat.updatedAt)}</Text>
        </Pressable>
      </NativeContextMenu>}
    />
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 12 }, safeTop: { height: 58 }, header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }, profile: { flexDirection: 'row', alignItems: 'center', gap: 10 }, logo: { width: 38, height: 38, borderRadius: 12 }, brand: { fontSize: 21, fontWeight: '800', letterSpacing: -0.6 }, search: { minHeight: 46, borderRadius: 14, marginHorizontal: 6, marginVertical: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, searchPlaceholder: { fontSize: 16 }, action: { minHeight: 46, borderRadius: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, actionText: { fontSize: 16, flex: 1 }, folderList: { paddingLeft: 18 }, folderRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 }, folderChat: { minHeight: 36, flexDirection: 'row', alignItems: 'center', paddingLeft: 35, paddingRight: 12, gap: 9 }, folderTitle: { flex: 1, fontSize: 14 }, list: { paddingBottom: 50 }, section: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, paddingHorizontal: 12, paddingTop: 18, paddingBottom: 5 }, chatRow: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, chatTitle: { flex: 1, fontSize: 15 }, time: { fontSize: 12 }, empty: { textAlign: 'center', paddingVertical: 44 }, error: { padding: 12, textAlign: 'center' }, syncError: { marginHorizontal: 6, marginVertical: 5, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, syncErrorText: { flex: 1, fontSize: 12, lineHeight: 16 }, preview: { width: 300, borderRadius: 22, padding: 20, alignItems: 'center', gap: 8 }, previewLogo: { width: 42, height: 42, borderRadius: 13 }, previewTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
})
