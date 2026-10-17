import type { FileNode } from '@pulpo/contracts'
import { DEFAULT_FILE_SORT, parseFileSort, sortFileNodes, type FileSort, type FileSortKey } from '@pulpo/client-core/files'
import type { NativeStackHeaderItem, NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, BackHandler, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { getValue, setValue } from '../../../data/database'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { PageHeader, Screen } from '../../../mockup5/src/components/PrototypeUI'
import { showActions, promptText } from '../../../platform/materialActions'
import { MaterialIconButton, MaterialSearchField } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { refreshFilesCapability, useFilesEnabled, isFilesDisabledError } from '../availability'
import { FilesTurnedOff } from '../components/FilesTurnedOff'
import { FileRow } from '../components/FileRow'
import { FilesToastHost } from '../components/FilesToastHost'
import { FolderPickerSheet } from '../components/FolderPickerSheet'
import { filesErrorMessage, isBuiltIn } from '../display'
import { fileItemActions, type FileItemActionId } from '../itemActions'
import { shareFileItem, useFileDownloads, useOpenFileItem } from '../open'
import { useFileOperations } from '../operations'
import { folderQuery } from '../queries'
import { cancelUpload, enqueueUploads, pickUploads, resumeUploads, retryUpload, useFileUploads, type QueuedUpload } from '../uploads'
import { useFilesNamespace } from '../useFilesNamespace'

type Props = NativeStackScreenProps<RootStackParamList, 'FilesFolder'>

/** iOS 26 puts the search field in a bar at the bottom of an iPhone's screen; toasts sit above it. */
const BOTTOM_SEARCH_HEIGHT = Platform.OS === 'ios' && !Platform.isPad && Number.parseInt(String(Platform.Version), 10) >= 26 ? 64 : 0

const SORT_LABELS: Record<FileSortKey, string> = { name: 'Name', modified: 'Date Modified', size: 'Size', kind: 'Kind' }

/** The sort Files lists use, kept per account. */
const useFileSort = create<{ sort: FileSort; loaded: string | null; set: (namespace: string, sort: FileSort) => void; load: (namespace: string) => void }>((set, get) => ({
  sort: DEFAULT_FILE_SORT,
  loaded: null,
  set: (namespace, sort) => {
    set({ sort })
    void setValue(namespace, 'files:sort', sort).catch(() => undefined)
  },
  load: (namespace) => {
    if (get().loaded === namespace) return
    set({ loaded: namespace })
    void getValue(namespace, 'files:sort').then((value) => set({ sort: parseFileSort(value) })).catch(() => undefined)
  },
}))

function promptName(title: string, value: string, confirm: string, onSubmit: (name: string) => void) {
  if (Platform.OS === 'ios') {
    Alert.prompt(title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirm, isPreferred: true, onPress: (name?: string) => { if (name?.trim()) onSubmit(name.trim()) } },
    ], 'plain-text', value)
  } else {
    promptText({ title, value, confirmLabel: confirm, onSubmit: (name) => { if (name.trim()) onSubmit(name.trim()) } })
  }
}

/** A Files folder, as a native screen: one per folder, so Back walks up the path. */
export function FilesFolderScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const folderId = route.params?.folderId ?? null
  const listing = useQuery({ ...folderQuery(namespace, folderId), enabled: Boolean(namespace) && filesEnabled })
  const operations = useFileOperations(namespace)
  const openItem = useOpenFileItem()
  const downloads = useFileDownloads((state) => state.active)
  const uploads = useFileUploads((state) => state.items)
  const { sort, set: setSortValue, load: loadSort } = useFileSort()
  const [search, setSearch] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [moving, setMoving] = useState<FileNode[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { if (namespace) loadSort(namespace) }, [loadSort, namespace])
  useEffect(() => { if (namespace) void resumeUploads(namespace, queryClient) }, [namespace, queryClient])
  useEffect(() => {
    if (isFilesDisabledError(listing.error)) void refreshFilesCapability()
  }, [listing.error])

  const folder = listing.data?.folder ?? null
  const title = folderId === null ? 'My files' : folder?.name ?? route.params?.name ?? 'Folder'
  const children = useMemo(() => listing.data?.children ?? [], [listing.data?.children])
  const items = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const visible = query ? children.filter((node) => node.name.toLocaleLowerCase().includes(query)) : children
    return sortFileNodes(visible, sort)
  }, [children, search, sort])
  // Uploads into this folder that the listing does not show yet (or that failed).
  const localUploads = useMemo(() => uploads.filter((upload) => (
    upload.namespace === namespace && upload.parentId === folderId && !children.some((node) => node.id === upload.reservedNodeId)
  )), [children, folderId, namespace, uploads])
  const selectedNodes = useMemo(() => items.filter((node) => selected.has(node.id)), [items, selected])

  const setSort = useCallback((next: FileSort) => setSortValue(namespace, next), [namespace, setSortValue])
  const exitSelection = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
    // The search field comes back empty (see `headerSearchBarOptions`), so its filter goes too.
    setSearch('')
  }, [])
  // Android's back button leaves selection before it leaves the folder.
  useEffect(() => {
    if (Platform.OS !== 'android' || !selecting) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelection()
      return true
    })
    return () => subscription.remove()
  }, [exitSelection, selecting])

  const newFolder = useCallback(() => promptName('New Folder', 'Untitled folder', 'Create', (name) => {
    void operations.createFolder(folderId, name).then((created) => { if (created) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) })
  }), [folderId, operations])
  const newDocument = useCallback(async () => {
    const created = await operations.createDocument(folderId, children)
    if (created) navigation.push('FileDocument', { fileId: created.id, name: created.name, created: true })
  }, [children, folderId, navigation, operations])
  const upload = useCallback(async (source: 'photos' | 'camera' | 'files') => {
    try {
      const picked = await pickUploads(source)
      if (picked.length) await enqueueUploads(namespace, folderId, picked, queryClient)
    } catch (error) {
      Alert.alert('Couldn’t add files', filesErrorMessage(error))
    }
  }, [folderId, namespace, queryClient])

  const runAction = useCallback((node: FileNode, action: string) => {
    const id = action as FileItemActionId
    switch (id) {
      case 'open': void openItem(node); return
      case 'select':
        setSelecting(true)
        setSelected(new Set([node.id]))
        return
      case 'rename':
        promptName('Rename', node.name, 'Rename', (name) => { void operations.rename(node, name) })
        return
      case 'move': setMoving([node]); return
      case 'duplicate': void operations.duplicate([node], node.parentId); return
      case 'pin': void operations.setPinned([node], true); return
      case 'unpin': void operations.setPinned([node], false); return
      case 'share': void shareFileItem(node).catch((error) => operations.fail(error, node.name)); return
      case 'accept-suggestion': void operations.resolveSuggestion(node, 'accept'); return
      case 'reject-suggestion':
        Alert.alert(`Remove “${node.name}”?`, 'The agent suggested this item. Removing it deletes it, and anything you added inside moves up a level.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => { void operations.resolveSuggestion(node, 'reject') } },
        ])
        return
      case 'trash': void operations.trash([node]).then((done) => { if (done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) }); return
      case 'add-to-chat':
      case 'open-in-new-chat':
        return
    }
  }, [openItem, operations])

  const actionsFor = useCallback((node: FileNode) => fileItemActions(node, { agent: 'none', selectable: true }), [])
  const press = useCallback((node: FileNode) => {
    if (!selecting) {
      void openItem(node)
      return
    }
    Haptics.selectionAsync()
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
  }, [openItem, selecting])
  const longPress = useCallback((node: FileNode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    showActions(node.name, actionsFor(node).map((action) => ({
      label: action.title,
      icon: action.systemImage,
      destructive: action.destructive,
      onPress: () => runAction(node, action.id),
    })))
  }, [actionsFor, runAction])

  const sortMenu: NativeStackHeaderItem = {
    type: 'menu',
    label: 'More',
    icon: { type: 'sfSymbol', name: 'ellipsis' },
    menu: {
      items: [
        { type: 'action', label: 'Select', icon: { type: 'sfSymbol', name: 'checkmark.circle' }, onPress: () => setSelecting(true), disabled: !items.length },
        {
          type: 'submenu',
          label: 'Sort By',
          icon: { type: 'sfSymbol', name: 'arrow.up.arrow.down' },
          inline: true,
          items: (Object.keys(SORT_LABELS) as FileSortKey[]).map((key) => ({
            type: 'action' as const,
            label: SORT_LABELS[key],
            state: sort.key === key ? 'on' as const : 'off' as const,
            icon: sort.key === key ? { type: 'sfSymbol' as const, name: sort.direction === 'asc' ? 'chevron.up' : 'chevron.down' } : undefined,
            onPress: () => setSort(sort.key === key
              ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
              : { key, direction: key === 'modified' || key === 'size' ? 'desc' : 'asc' }),
          })),
        },
      ],
    },
  }
  const addMenu: NativeStackHeaderItem = {
    type: 'menu',
    label: 'Add',
    icon: { type: 'sfSymbol', name: 'plus' },
    identifier: 'files-add',
    menu: {
      items: [
        { type: 'action', label: 'New Document', icon: { type: 'sfSymbol', name: 'doc.badge.plus' }, onPress: () => { void newDocument() } },
        { type: 'action', label: 'New Folder', icon: { type: 'sfSymbol', name: 'folder.badge.plus' }, onPress: newFolder },
        {
          type: 'submenu',
          label: 'Upload',
          inline: true,
          items: [
            { type: 'action', label: 'Photo Library', icon: { type: 'sfSymbol', name: 'photo.on.rectangle' }, onPress: () => { void upload('photos') } },
            { type: 'action', label: 'Take Photo or Video', icon: { type: 'sfSymbol', name: 'camera' }, onPress: () => { void upload('camera') } },
            { type: 'action', label: 'Choose Files', icon: { type: 'sfSymbol', name: 'folder' }, onPress: () => { void upload('files') } },
          ],
        },
      ],
    },
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerShown: Platform.OS === 'ios',
      headerLargeTitle: true,
      headerBackTitle: 'Back',
      // While selecting, the selection actions take the bottom of the screen, where iOS 26 keeps
      // the search field, as in the Files app.
      headerSearchBarOptions: Platform.OS === 'ios' && filesEnabled && !selecting ? {
        placeholder: folderId === null ? 'Search My files' : `Search ${title}`,
        hideWhenScrolling: true,
        onChangeText: (event) => setSearch(event.nativeEvent.text),
        onCancelButtonPress: () => setSearch(''),
      } : undefined,
      headerLeft: selecting ? () => null : undefined,
      unstable_headerRightItems: Platform.OS !== 'ios' || !filesEnabled ? undefined : () => selecting
        ? [{ type: 'button', label: 'Done', variant: 'done', onPress: exitSelection }]
        : [addMenu, sortMenu],
    })
  })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await listing.refetch()
    } finally {
      setRefreshing(false)
    }
  }, [listing])

  if (!filesEnabled) {
    return Platform.OS === 'android'
      ? <Screen scroll={false}><PageHeader title={title} onBack={() => navigation.goBack()} /><FilesTurnedOff /></Screen>
      : <FilesTurnedOff />
  }

  const renderUpload = (upload: QueuedUpload) => (
    <Pressable
      key={upload.id}
      // Only a stopped upload offers anything (try again or remove).
      accessibilityRole={upload.state === 'failed' || upload.state === 'offline' ? 'button' : undefined}
      accessibilityLabel={`${upload.name}, ${upload.state === 'failed' ? `upload failed: ${upload.error}` : upload.state === 'offline' ? 'waiting for a connection' : 'uploading'}`}
      onPress={() => {
        if (upload.state !== 'failed' && upload.state !== 'offline') return
        Alert.alert(upload.name, upload.error ?? 'Waiting for a connection.', [
          { text: 'Remove', style: 'destructive', onPress: () => { void cancelUpload(upload.id) } },
          { text: 'Try Again', onPress: () => retryUpload(upload.id) },
          { text: 'Close', style: 'cancel' },
        ])
      }}
      style={styles.uploadRow}
    >
      {upload.state === 'failed'
        ? <SymbolView name="exclamationmark.triangle.fill" size={20} tintColor={theme.orange} />
        : upload.state === 'offline'
          ? <SymbolView name="icloud.slash" size={20} tintColor={theme.secondary} />
          : <ActivityIndicator size="small" color={theme.secondary} />}
      <View style={styles.uploadText}>
        <Text numberOfLines={1} style={[styles.uploadName, { color: theme.text }]}>{upload.name}</Text>
        <Text numberOfLines={1} style={[styles.uploadState, { color: upload.state === 'failed' ? theme.orange : theme.secondary }]}>
          {upload.state === 'failed' ? upload.error ?? 'Upload failed' : upload.state === 'offline' ? 'Waiting for a connection' : upload.state === 'waiting' ? 'Waiting to upload' : 'Uploading…'}
        </Text>
      </View>
    </Pressable>
  )

  // Android draws its own header, above the list so that it stays in every state.
  const androidHeader = Platform.OS !== 'android' ? null : selecting ? (
    <PageHeader
      title={selectedNodes.length ? `${selectedNodes.length} selected` : 'Select items'}
      onBack={exitSelection}
      right={<MaterialIconButton icon="checkmark" label="Done" onPress={exitSelection} />}
    />
  ) : (
    <View>
      <PageHeader
        title={title}
        onBack={() => navigation.goBack()}
        right={<View style={styles.androidActions}>
          <MaterialIconButton icon="plus" label="Add" onPress={() => showActions('Add', [
            { label: 'New document', icon: 'doc.badge.plus', onPress: () => { void newDocument() } },
            { label: 'New folder', icon: 'folder.badge.plus', onPress: newFolder },
            { label: 'Photo library', icon: 'photo.on.rectangle', onPress: () => { void upload('photos') } },
            { label: 'Take photo', icon: 'camera', onPress: () => { void upload('camera') } },
            { label: 'Choose files', icon: 'folder', onPress: () => { void upload('files') } },
          ])} />
          <MaterialIconButton icon="ellipsis" label="More" onPress={() => showActions(title, [
            ...(items.length ? [{ label: 'Select', icon: 'checkmark.circle', onPress: () => setSelecting(true) }] : []),
            ...(Object.keys(SORT_LABELS) as FileSortKey[]).map((key) => ({
              label: `Sort by ${SORT_LABELS[key].toLowerCase()}`,
              selected: sort.key === key,
              onPress: () => setSort(sort.key === key ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'modified' || key === 'size' ? 'desc' : 'asc' }),
            })),
          ])} />
        </View>}
      />
      <MaterialSearchField value={search} onChange={setSearch} onFocusChange={() => {}} placeholder={folderId === null ? 'Search My files' : `Search ${title}`} />
    </View>
  )

  // Android's screen already keeps clear of the bottom inset.
  const bottomInset = Platform.OS === 'android' ? 0 : insets.bottom
  const header = (
    <View>
      {listing.data?.offline ? (
        <View style={[styles.banner, { backgroundColor: theme.fill }]}>
          <SymbolView name="icloud.slash" size={15} tintColor={theme.secondary} />
          <Text style={[styles.bannerText, { color: theme.secondary }]}>You’re offline. Showing this folder as you last saw it.</Text>
        </View>
      ) : null}
      {folder?.suggestion ? (
        <View style={[styles.banner, { backgroundColor: theme.fill }]}>
          <SymbolView name="sparkles" size={15} tintColor={theme.green} />
          <Text style={[styles.bannerText, { color: theme.text }]}>The agent suggested this folder.</Text>
          <Pressable accessibilityRole="button" onPress={() => runAction(folder, 'accept-suggestion')}><Text style={[styles.bannerAction, { color: theme.blue }]}>Keep</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => runAction(folder, 'reject-suggestion')}><Text style={[styles.bannerAction, { color: theme.red }]}>Remove</Text></Pressable>
        </View>
      ) : null}
      {folderId === null && !search ? (
        <Pressable
          accessibilityHint="Opens deleted chats and files"
          accessibilityLabel="Trash"
          accessibilityRole="button"
          onPress={() => navigation.navigate('Trash')}
          style={({ pressed }) => [styles.trashRow, pressed && { opacity: 0.6 }]}
          testID="files-trash"
        >
          <View style={styles.trashIcon}><SymbolView name="trash.fill" size={24} tintColor="#FF3B30" /></View>
          <View style={[styles.trashText, { borderBottomColor: theme.separator }]}>
            <Text style={[styles.trashName, { color: theme.text }]}>Trash</Text>
            <SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} />
          </View>
        </Pressable>
      ) : null}
      {localUploads.map(renderUpload)}
    </View>
  )

  const content = listing.isPending ? (
    <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>
  ) : listing.isError && !listing.data ? (
    <View style={styles.center}>
      <SymbolView name={isFilesDisabledError(listing.error) ? 'folder.badge.questionmark' : 'exclamationmark.triangle'} size={40} tintColor={theme.tertiary} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>Couldn’t open this folder</Text>
      <Text style={[styles.emptyBody, { color: theme.secondary }]}>{filesErrorMessage(listing.error)}</Text>
      <Pressable accessibilityRole="button" onPress={() => { void listing.refetch() }} style={styles.retry}><Text style={[styles.retryLabel, { color: theme.blue }]}>Try Again</Text></Pressable>
    </View>
  ) : (
    <FlatList
      data={items}
      keyExtractor={(node) => node.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottomInset + (selecting ? 96 : 32) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh() }} />}
      ListEmptyComponent={localUploads.length ? null : (
        <View style={styles.empty}>
          <SymbolView name={search ? 'magnifyingglass' : 'folder'} size={44} tintColor={theme.tertiary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{search ? 'No matches' : 'This folder is empty'}</Text>
          {!search ? <Text style={[styles.emptyBody, { color: theme.secondary }]}>Create a document or folder, or upload photos and files.</Text> : null}
          {!search ? (
            <Pressable accessibilityRole="button" onPress={() => { void newDocument() }} style={[styles.emptyButton, { backgroundColor: theme.fillStrong }]} testID="files-empty-new-document">
              <SymbolView name="doc.badge.plus" size={17} tintColor={theme.blue} />
              <Text style={[styles.emptyButtonLabel, { color: theme.blue }]}>New Document</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      renderItem={({ item, index }) => (
        <FileRow
          node={item}
          actions={actionsFor(item)}
          selecting={selecting}
          selected={selected.has(item.id)}
          busy={Boolean(downloads[item.id])}
          last={index === items.length - 1}
          onPress={press}
          onAction={runAction}
          onLongPress={longPress}
        />
      )}
    />
  )

  const selectionBar = selecting ? (
    <View style={[styles.selectionBar, { paddingBottom: bottomInset + 8, backgroundColor: theme.isDark ? theme.elevated : theme.elevated, borderTopColor: theme.separator }]}>
      <Text style={[styles.selectionCount, { color: theme.secondary }]}>{selectedNodes.length ? `${selectedNodes.length} selected` : 'Select items'}</Text>
      <View style={styles.selectionActions}>
        {[
          { icon: 'folder', label: 'Move', disabled: !selectedNodes.length || selectedNodes.some(isBuiltIn), onPress: () => setMoving(selectedNodes) },
          { icon: 'plus.square.on.square', label: 'Duplicate', disabled: !selectedNodes.some((node) => node.kind !== 'chat') || selectedNodes.some(isBuiltIn), onPress: () => { void operations.duplicate(selectedNodes, folderId).then(exitSelection) } },
          { icon: 'trash', label: 'Trash', destructive: true, disabled: !selectedNodes.length || selectedNodes.some(isBuiltIn), onPress: () => {
            Alert.alert(`Move ${selectedNodes.length === 1 ? `“${selectedNodes[0]!.name}”` : `${selectedNodes.length} items`} to the trash?`, undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Move to Trash', style: 'destructive', onPress: () => { void operations.trash(selectedNodes).then(exitSelection) } },
            ])
          } },
        ].map((action) => (
          <Pressable key={action.label} accessibilityLabel={action.label} accessibilityRole="button" accessibilityState={{ disabled: action.disabled }} disabled={action.disabled} onPress={action.onPress} style={({ pressed }) => [styles.selectionAction, pressed && { opacity: 0.6 }]} testID={`files-selection-${action.label.toLowerCase()}`}>
            <SymbolView name={action.icon as never} size={22} tintColor={action.disabled ? theme.tertiary : action.destructive ? theme.red : theme.blue} />
            <Text style={[styles.selectionLabel, { color: action.disabled ? theme.tertiary : action.destructive ? theme.red : theme.blue }]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null

  const body = (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {androidHeader}
      {content}
      {selectionBar}
      <FilesToastHost bottomOffset={selecting ? 72 : BOTTOM_SEARCH_HEIGHT} />
      {moving ? (
        <FolderPickerSheet
          namespace={namespace}
          mode="destination"
          title={moving.length === 1 ? `Move “${moving[0]!.name}”` : `Move ${moving.length} items`}
          confirmLabel="Move Here"
          initialFolderId={folderId}
          excludeIds={moving.map((node) => node.id)}
          sourceFolderIds={moving.map((node) => node.parentId)}
          onCancel={() => setMoving(null)}
          onConfirm={(destination) => {
            const nodes = moving
            setMoving(null)
            exitSelection()
            void operations.move(nodes, destination)
          }}
        />
      ) : null}
    </View>
  )
  return Platform.OS === 'android' ? <Screen scroll={false}>{body}</Screen> : body
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  emptyButton: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  emptyButtonLabel: { fontSize: 16, fontWeight: '600' },
  retry: { marginTop: 8, padding: 8 },
  retryLabel: { fontSize: 17, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 4, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 19 },
  bannerAction: { fontSize: 15, fontWeight: '600', paddingHorizontal: 4 },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 24, paddingRight: 16, minHeight: 60 },
  uploadText: { flex: 1 },
  uploadName: { fontSize: 17 },
  uploadState: { fontSize: 13, marginTop: 1 },
  androidActions: { flexDirection: 'row', alignItems: 'center' },
  trashRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 56 },
  trashIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  trashText: { flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  trashName: { fontSize: 17 },
  selectionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingHorizontal: 16 },
  selectionCount: { textAlign: 'center', fontSize: 13, marginBottom: 4 },
  selectionActions: { flexDirection: 'row', justifyContent: 'space-around' },
  selectionAction: { alignItems: 'center', gap: 2, minWidth: 72, paddingVertical: 4 },
  selectionLabel: { fontSize: 11, fontWeight: '500' },
})
