import type { FileNode, TrashItem } from '@pulpo/contracts'
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
import { usePrototypeStore } from '../../../mockup5/src/store/prototypeStore'
import { legacyTrashView, trashDeletesLabel, trashItemSubtitle, trashQuery, trashRetentionSummary } from '../../trash/api'
import { TRASH_FOLDER_ID, trashFolderNode, trashFolderRef, trashLocation } from '../../trash/folder'
import { useTrashOperations } from '../../trash/operations'
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
import { fileItemActions, trashItemActions, type FileItemActionId, type TrashItemActionId } from '../itemActions'
import { shareFileItem, useFileDownloads, useOpenFileItem } from '../open'
import { useFileOperations } from '../operations'
import { folderQuery } from '../queries'
import { cancelUpload, enqueueUploads, pickUploads, resumeUploads, retryUpload, useFileUploads, type QueuedUpload } from '../uploads'
import { useFilesNamespace } from '../useFilesNamespace'

type Props = NativeStackScreenProps<RootStackParamList, 'FilesFolder'>

/** iOS 26 puts the search field in a bar at the bottom of an iPhone's screen; toasts sit above it. */
const BOTTOM_SEARCH_HEIGHT = Platform.OS === 'ios' && !Platform.isPad && Number.parseInt(String(Platform.Version), 10) >= 26 ? 64 : 0

const SORT_LABELS: Record<FileSortKey, string> = { name: 'Name', modified: 'Date Modified', size: 'Size', kind: 'Kind' }
/** The trash sorts by when items were trashed in place of when they changed. */
const TRASH_SORT_LABELS: Record<FileSortKey, string> = { ...SORT_LABELS, modified: 'Date Trashed' }

/** A sort for Files lists, kept per account under `key`. */
const createSortStore = (key: string, fallback: FileSort) => create<{ sort: FileSort; loaded: string | null; set: (namespace: string, sort: FileSort) => void; load: (namespace: string) => void }>((set, get) => ({
  sort: fallback,
  loaded: null,
  set: (namespace, sort) => {
    set({ sort })
    void setValue(namespace, key, sort).catch(() => undefined)
  },
  load: (namespace) => {
    if (get().loaded === namespace) return
    set({ loaded: namespace })
    void getValue(namespace, key).then((value) => set({ sort: parseFileSort(value, fallback) })).catch(() => undefined)
  },
}))
const useFileSort = createSortStore('files:sort', DEFAULT_FILE_SORT)
/** The trash keeps its own order, newest trashed first until changed (as on the web). */
const useTrashSort = createSortStore('trash:sort', { key: 'modified', direction: 'desc' })

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

/**
 * A Files folder, as a native screen: one per folder, so Back walks up the path. The trash is one
 * of them, a built-in folder of My files (as on the web): its items are restored or deleted for
 * good, and its trashed folders are looked through like any other.
 */
export function FilesFolderScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const ref = route.params?.folderId ?? null
  // Where this screen is in the trash, if it is: the trash itself, or a trashed folder in it.
  const trash = trashLocation(ref)
  const inTrash = trash !== null
  const folderId = inTrash ? null : ref
  const folderListing = useQuery({ ...folderQuery(namespace, folderId), enabled: Boolean(namespace) && filesEnabled && !inTrash })
  const trashListing = useQuery({ ...trashQuery(namespace, trash?.folderId ?? null), enabled: Boolean(namespace) && inTrash })
  const listing = inTrash ? trashListing : folderListing
  // Servers that predate the shared trash list no trash; there it holds the chat store's trashed chats.
  const legacyTrash = inTrash && trashListing.data === null
  const legacyChats = usePrototypeStore((state) => legacyTrash ? state.chats : null)
  const retention = usePrototypeStore((state) => state.preferences.trashRetention)
  const legacyView = useMemo(() => legacyChats ? legacyTrashView(legacyChats, retention) : null, [legacyChats, retention])
  const trashView = !inTrash ? undefined : legacyView ?? trashListing.data ?? undefined
  const operations = useFileOperations(namespace)
  const trashOperations = useTrashOperations(namespace, legacyTrash)
  const openItem = useOpenFileItem()
  const downloads = useFileDownloads((state) => state.active)
  const uploads = useFileUploads((state) => state.items)
  const fileSort = useFileSort()
  const trashSort = useTrashSort()
  const { sort, set: setSortValue, load: loadSort } = inTrash ? trashSort : fileSort
  const [search, setSearch] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [moving, setMoving] = useState<FileNode[] | null>(null)
  const [restoring, setRestoring] = useState<FileNode[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Trash deadlines count down while the trash is shown.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { if (namespace) loadSort(namespace) }, [loadSort, namespace])
  useEffect(() => { if (namespace) void resumeUploads(namespace, queryClient) }, [namespace, queryClient])
  useEffect(() => {
    if (isFilesDisabledError(folderListing.error)) void refreshFilesCapability()
  }, [folderListing.error])
  useEffect(() => {
    if (!inTrash) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [inTrash])

  const folder = inTrash ? trashView?.folder ?? null : folderListing.data?.folder ?? null
  const title = inTrash
    ? trash.folderId ? folder?.name ?? route.params?.name ?? 'Folder' : 'Trash'
    : folderId === null ? 'My files' : folder?.name ?? route.params?.name ?? 'Folder'
  const children: FileNode[] = useMemo(() => {
    if (inTrash) return trashView?.children ?? []
    const listed = folderListing.data?.children ?? []
    // The trash sits in My files with the other built-in folders.
    return folderId === null && folderListing.data ? [...listed, trashFolderNode()] : listed
  }, [folderId, folderListing.data, inTrash, trashView?.children])
  const items = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const visible = query ? children.filter((node) => node.name.toLocaleLowerCase().includes(query)) : children
    return inTrash ? sortFileNodes(visible as TrashItem[], sort, (node) => node.trashedAt) : sortFileNodes(visible, sort)
  }, [children, inTrash, search, sort])
  // Uploads into this folder that the listing does not show yet (or that failed).
  const localUploads = useMemo(() => inTrash ? [] : uploads.filter((upload) => (
    upload.namespace === namespace && upload.parentId === folderId && !children.some((node) => node.id === upload.reservedNodeId)
  )), [children, folderId, inTrash, namespace, uploads])
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
  const newRecording = useCallback(async () => {
    const created = await operations.createRecording(folderId)
    if (created) navigation.push('FileRecording', { fileId: created.id, name: created.name })
  }, [folderId, navigation, operations])
  const upload = useCallback(async (source: 'photos' | 'camera' | 'files') => {
    try {
      const picked = await pickUploads(source)
      if (picked.length) await enqueueUploads(namespace, folderId, picked, queryClient)
    } catch (error) {
      Alert.alert('Couldn’t add files', filesErrorMessage(error))
    }
  }, [folderId, namespace, queryClient])

  /**
   * Trashes items, asking first when that deletes chats for good (no trash retention), as the drawer
   * does, or when `confirm` asks for it anyway.
   */
  const trashItems = useCallback((nodes: readonly FileNode[], options: { confirm?: boolean; then?: () => void } = {}) => {
    const run = () => { void operations.trash(nodes).then((done) => {
      if (done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      options.then?.()
    }) }
    const chats = nodes.filter((node) => node.kind === 'chat').length
    const deletesChats = chats > 0 && usePrototypeStore.getState().preferences.trashRetention === 'instant'
    if (!deletesChats && !options.confirm) {
      run()
      return
    }
    const subject = nodes.length === 1 ? `“${nodes[0]!.name}”` : `${nodes.length} items`
    if (!deletesChats) {
      Alert.alert(`Move ${subject} to the trash?`, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Move to Trash', style: 'destructive', onPress: run },
      ])
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    const [title, message] = nodes.length === 1
      ? ['Delete chat?', `${subject} will be removed from your history.`]
      : chats === nodes.length
        ? [`Delete ${nodes.length} chats?`, 'They will be removed from your history.']
        : [`Delete ${nodes.length} items?`, 'Chats are deleted for good. Everything else moves to the trash.']
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ])
  }, [operations])

  /** In the trash, folders can be looked through; anything else has to be restored first. */
  const openNode = useCallback((node: FileNode) => {
    if (!inTrash) {
      void openItem(node)
      return
    }
    if (node.kind === 'folder') navigation.push('FilesFolder', { folderId: trashFolderRef(node.id), name: node.name })
    else operations.notify(`“${node.name}” is in the trash. Restore it to open it.`)
  }, [inTrash, navigation, openItem, operations])

  /** Back to the trash itself from a trashed folder in it (after it is emptied or restored). */
  const showTrashRoot = useCallback(() => {
    const state = navigation.getState()
    for (let index = state.index - 1; index >= 0; index -= 1) {
      const candidate = state.routes[index]!
      if (candidate.name === 'FilesFolder' && (candidate.params as Props['route']['params'] | undefined)?.folderId === TRASH_FOLDER_ID) {
        navigation.pop(state.index - index)
        return
      }
    }
    navigation.replace('FilesFolder', { folderId: TRASH_FOLDER_ID, name: 'Trash' })
  }, [navigation])

  const confirmDeleteForever = useCallback((nodes: readonly FileNode[], then?: () => void) => {
    if (!nodes.length) return
    const [first] = nodes
    const message = nodes.length !== 1
      ? `${nodes.length} items and everything inside them will be permanently deleted. This cannot be undone.`
      : first!.kind === 'folder'
        ? `“${first!.name}” and everything inside it will be permanently deleted. This cannot be undone.`
        : `“${first!.name}” will be permanently deleted. This cannot be undone.`
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    Alert.alert('Delete forever?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Forever', style: 'destructive', onPress: () => { void trashOperations.deleteForever(nodes).then(() => then?.()) } },
    ])
  }, [trashOperations])

  const confirmEmptyTrash = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    Alert.alert('Empty the trash?', 'Everything in the trash will be permanently deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Forever',
        style: 'destructive',
        onPress: () => { void trashOperations.empty().then((done) => {
          // The trashed folder shown goes with everything else.
          if (done && trash?.folderId) showTrashRoot()
        }) },
      },
    ])
  }, [showTrashRoot, trash?.folderId, trashOperations])

  /** Restores the trashed folder shown, then shows it where it went (without Files, it is back in the drawer). */
  const restoreShownFolder = useCallback(async () => {
    if (!trashView?.folder) return
    const [restored] = await trashOperations.restore([trashView.folder]) ?? []
    if (!restored) return
    if (filesEnabled) navigation.replace('FilesFolder', { folderId: restored.id, name: restored.name })
    else showTrashRoot()
  }, [filesEnabled, navigation, showTrashRoot, trashOperations, trashView?.folder])

  const startSelection = useCallback((node: FileNode) => {
    setSelecting(true)
    setSelected(new Set([node.id]))
  }, [])

  const runTrashAction = useCallback((node: FileNode, action: string) => {
    switch (action as TrashItemActionId) {
      case 'open': openNode(node); return
      case 'restore': void trashOperations.restore([node]); return
      case 'restore-to': setRestoring([node]); return
      case 'select': startSelection(node); return
      case 'delete-forever': confirmDeleteForever([node])
    }
  }, [confirmDeleteForever, openNode, startSelection, trashOperations])

  const runFileAction = useCallback((node: FileNode, action: string) => {
    const id = action as FileItemActionId
    switch (id) {
      case 'open': openNode(node); return
      case 'select': startSelection(node); return
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
      case 'trash': trashItems([node]); return
      case 'add-to-chat':
      case 'open-in-new-chat':
        return
    }
  }, [openNode, operations, startSelection, trashItems])
  const runAction = inTrash ? runTrashAction : runFileAction

  // Trashed items are restored into a chosen folder only while Files is on.
  const restoreTo = Boolean(trashView?.files && filesEnabled)
  const actionsFor = useCallback((node: FileNode) => inTrash
    ? trashItemActions(node, { files: restoreTo, selectable: true })
    : fileItemActions(node, { agent: 'none', selectable: true }), [inTrash, restoreTo])
  const press = useCallback((node: FileNode) => {
    if (!selecting) {
      openNode(node)
      return
    }
    Haptics.selectionAsync()
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
  }, [openNode, selecting])
  const longPress = useCallback((node: FileNode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    showActions(node.name, actionsFor(node).map((action) => ({
      label: action.title,
      icon: action.systemImage,
      destructive: action.destructive,
      onPress: () => runAction(node, action.id),
    })))
  }, [actionsFor, runAction])

  const sortLabels = inTrash ? TRASH_SORT_LABELS : SORT_LABELS
  const sortMenu: NativeStackHeaderItem = {
    type: 'menu',
    label: 'More',
    icon: { type: 'sfSymbol', name: 'ellipsis' },
    menu: {
      items: [
        { type: 'action', label: 'Select', icon: { type: 'sfSymbol', name: 'checkmark.circle' }, onPress: () => setSelecting(true), disabled: !items.length },
        ...(inTrash ? [{
          type: 'action',
          label: 'Empty Trash',
          icon: { type: 'sfSymbol', name: 'trash' },
          destructive: true,
          // A trashed folder's own contents may be empty while the trash is not.
          disabled: !trash.folderId && !items.length,
          onPress: confirmEmptyTrash,
        } as const] : []),
        {
          type: 'submenu',
          label: 'Sort By',
          icon: { type: 'sfSymbol', name: 'arrow.up.arrow.down' },
          inline: true,
          items: (Object.keys(sortLabels) as FileSortKey[]).map((key) => ({
            type: 'action' as const,
            label: sortLabels[key],
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
        { type: 'action', label: 'New Voice Recording', icon: { type: 'sfSymbol', name: 'mic.badge.plus' }, onPress: () => { void newRecording() } },
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
      headerSearchBarOptions: Platform.OS === 'ios' && (filesEnabled || inTrash) && !selecting ? {
        placeholder: !inTrash && folderId === null ? 'Search My files' : `Search ${title}`,
        hideWhenScrolling: true,
        onChangeText: (event) => setSearch(event.nativeEvent.text),
        onCancelButtonPress: () => setSearch(''),
      } : undefined,
      headerLeft: selecting ? () => null : undefined,
      unstable_headerRightItems: Platform.OS !== 'ios' || (!filesEnabled && !inTrash) ? undefined : () => selecting
        ? [{ type: 'button', label: 'Done', variant: 'done', onPress: exitSelection }]
        // Nothing is added to the trash here: items are moved to it from where they are.
        : inTrash ? [sortMenu] : [addMenu, sortMenu],
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

  // Without Files, the trash still holds chats and drawer folders.
  if (!filesEnabled && !inTrash) {
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
          {inTrash ? null : <MaterialIconButton icon="plus" label="Add" onPress={() => showActions('Add', [
            { label: 'New document', icon: 'doc.badge.plus', onPress: () => { void newDocument() } },
            { label: 'New voice recording', icon: 'mic.badge.plus', onPress: () => { void newRecording() } },
            { label: 'New folder', icon: 'folder.badge.plus', onPress: newFolder },
            { label: 'Photo library', icon: 'photo.on.rectangle', onPress: () => { void upload('photos') } },
            { label: 'Take photo', icon: 'camera', onPress: () => { void upload('camera') } },
            { label: 'Choose files', icon: 'folder', onPress: () => { void upload('files') } },
          ])} />}
          <MaterialIconButton icon="ellipsis" label="More" onPress={() => showActions(title, [
            ...(items.length ? [{ label: 'Select', icon: 'checkmark.circle', onPress: () => setSelecting(true) }] : []),
            ...(inTrash && (trash.folderId || items.length) ? [{ label: 'Empty trash', icon: 'trash', destructive: true, onPress: confirmEmptyTrash }] : []),
            ...(Object.keys(sortLabels) as FileSortKey[]).map((key) => ({
              label: `Sort by ${sortLabels[key].toLowerCase()}`,
              selected: sort.key === key,
              onPress: () => setSort(sort.key === key ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'modified' || key === 'size' ? 'desc' : 'asc' }),
            })),
          ])} />
        </View>}
      />
      <MaterialSearchField value={search} onChange={setSearch} onFocusChange={() => {}} placeholder={!inTrash && folderId === null ? 'Search My files' : `Search ${title}`} />
    </View>
  )

  // Android's screen already keeps clear of the bottom inset.
  const bottomInset = Platform.OS === 'android' ? 0 : insets.bottom
  const header = (
    <View>
      {listing.data?.offline ? (
        <View style={[styles.banner, { backgroundColor: theme.fill }]}>
          <SymbolView name="icloud.slash" size={15} tintColor={theme.secondary} />
          <Text style={[styles.bannerText, { color: theme.secondary }]}>You’re offline. Showing {inTrash && !trash.folderId ? 'the trash' : 'this folder'} as you last saw it.</Text>
        </View>
      ) : null}
      {/* What happens to items in the trash, or, in a trashed folder, when it goes and a way to bring it back. */}
      {trashView && !search ? (
        <View style={[styles.banner, { backgroundColor: theme.fill }]} testID="files-trash-banner">
          <SymbolView name={trashView.folder ? 'trash' : 'clock'} size={15} tintColor={theme.secondary} />
          {trashView.folder ? (
            <>
              <Text style={[styles.bannerText, { color: theme.secondary }]}>This folder is in the trash. {trashDeletesLabel(trashView.folder.purgeAt, now)}.</Text>
              <Pressable accessibilityRole="button" onPress={() => { void restoreShownFolder() }}><Text style={[styles.bannerAction, { color: theme.blue }]}>Restore</Text></Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.bannerText, { color: theme.secondary }]}>
                {trashRetentionSummary(trashView.retention, trashView.files)}{trashView.files ? ' Files in the trash still count toward your storage.' : ''}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Change retention" onPress={() => navigation.navigate('SettingsDetail', { section: 'trash' })}><Text style={[styles.bannerAction, { color: theme.blue }]}>Change</Text></Pressable>
            </>
          )}
        </View>
      ) : null}
      {!inTrash && folder?.suggestion ? (
        <View style={[styles.banner, { backgroundColor: theme.fill }]}>
          <SymbolView name="sparkles" size={15} tintColor={theme.green} />
          <Text style={[styles.bannerText, { color: theme.text }]}>The agent suggested this folder.</Text>
          <Pressable accessibilityRole="button" onPress={() => runAction(folder, 'accept-suggestion')}><Text style={[styles.bannerAction, { color: theme.blue }]}>Keep</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => runAction(folder, 'reject-suggestion')}><Text style={[styles.bannerAction, { color: theme.red }]}>Remove</Text></Pressable>
        </View>
      ) : null}
      {localUploads.map(renderUpload)}
    </View>
  )

  const content = listing.isPending ? (
    <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>
  ) : listing.isError && !listing.data ? (
    <View style={styles.center}>
      <SymbolView name={isFilesDisabledError(listing.error) ? 'folder.badge.questionmark' : 'exclamationmark.triangle'} size={40} tintColor={theme.tertiary} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{inTrash && !trash.folderId ? 'Couldn’t open the trash' : 'Couldn’t open this folder'}</Text>
      <Text style={[styles.emptyBody, { color: theme.secondary }]}>{filesErrorMessage(listing.error)}</Text>
      <Pressable accessibilityRole="button" onPress={() => { void listing.refetch() }} style={styles.retry}><Text style={[styles.retryLabel, { color: theme.blue }]}>Try Again</Text></Pressable>
      {/* A trashed folder that was restored or deleted meanwhile is gone from the trash. */}
      {trash?.folderId ? <Pressable accessibilityRole="button" onPress={showTrashRoot} style={styles.retry}><Text style={[styles.retryLabel, { color: theme.blue }]}>Back to Trash</Text></Pressable> : null}
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
      ListEmptyComponent={localUploads.length ? null : inTrash ? (
        <View style={styles.empty}>
          <SymbolView name={search ? 'magnifyingglass' : trash.folderId ? 'folder' : 'trash'} size={44} tintColor={theme.tertiary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{search ? 'No matches' : trash.folderId ? 'This folder is empty' : 'The trash is empty'}</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <SymbolView name={search ? 'magnifyingglass' : 'folder'} size={44} tintColor={theme.tertiary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{search ? 'No matches' : 'This folder is empty'}</Text>
          {!search ? <Text style={[styles.emptyBody, { color: theme.secondary }]}>Create a document, voice recording, or folder, or upload photos and files.</Text> : null}
          {!search ? (
            <View style={styles.emptyButtons}>
              <Pressable accessibilityRole="button" onPress={() => { void newDocument() }} style={[styles.emptyButton, { backgroundColor: theme.fillStrong }]} testID="files-empty-new-document">
                <SymbolView name="doc.badge.plus" size={17} tintColor={theme.blue} />
                <Text style={[styles.emptyButtonLabel, { color: theme.blue }]}>New Document</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { void newRecording() }} style={[styles.emptyButton, { backgroundColor: theme.fillStrong }]} testID="files-empty-new-recording">
                <SymbolView name="mic.badge.plus" size={17} tintColor={theme.blue} />
                <Text style={[styles.emptyButtonLabel, { color: theme.blue }]}>New Voice Recording</Text>
              </Pressable>
            </View>
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
          subtitle={inTrash ? trashItemSubtitle(item as TrashItem, now) : undefined}
          opensFolder={inTrash ? item.kind === 'folder' : undefined}
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
        {(inTrash ? [
          { icon: 'arrow.uturn.backward.circle', label: 'Restore', disabled: !selectedNodes.length, onPress: () => { void trashOperations.restore(selectedNodes).then(exitSelection) } },
          ...(restoreTo ? [{ icon: 'folder', label: 'Restore To', disabled: !selectedNodes.length, onPress: () => setRestoring(selectedNodes) }] : []),
          { icon: 'trash', label: 'Delete', destructive: true, disabled: !selectedNodes.length, onPress: () => confirmDeleteForever(selectedNodes, exitSelection) },
        ] : [
          { icon: 'folder', label: 'Move', disabled: !selectedNodes.length || selectedNodes.some(isBuiltIn), onPress: () => setMoving(selectedNodes) },
          { icon: 'plus.square.on.square', label: 'Duplicate', disabled: !selectedNodes.some((node) => node.kind !== 'chat') || selectedNodes.some(isBuiltIn), onPress: () => { void operations.duplicate(selectedNodes, folderId).then(exitSelection) } },
          { icon: 'trash', label: 'Trash', destructive: true, disabled: !selectedNodes.length || selectedNodes.some(isBuiltIn), onPress: () => trashItems(selectedNodes, { confirm: true, then: exitSelection }) },
        ]).map((action: { icon: string; label: string; destructive?: boolean; disabled: boolean; onPress: () => void }) => (
          <Pressable key={action.label} accessibilityLabel={action.label} accessibilityRole="button" accessibilityState={{ disabled: action.disabled }} disabled={action.disabled} onPress={action.onPress} style={({ pressed }) => [styles.selectionAction, pressed && { opacity: 0.6 }]} testID={`files-selection-${action.label.toLowerCase().replace(/ /g, '-')}`}>
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
      {restoring ? (
        <FolderPickerSheet
          namespace={namespace}
          mode="destination"
          title={restoring.length === 1 ? `Restore “${restoring[0]!.name}”` : `Restore ${restoring.length} items`}
          confirmLabel="Restore Here"
          onCancel={() => setRestoring(null)}
          onConfirm={(destination) => {
            const nodes = restoring
            setRestoring(null)
            exitSelection()
            void trashOperations.restore(nodes, { parentId: destination })
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
  emptyButtons: { alignItems: 'center' },
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
  selectionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingHorizontal: 16 },
  selectionCount: { textAlign: 'center', fontSize: 13, marginBottom: 4 },
  selectionActions: { flexDirection: 'row', justifyContent: 'space-around' },
  selectionAction: { alignItems: 'center', gap: 2, minWidth: 72, paddingVertical: 4 },
  selectionLabel: { fontSize: 11, fontWeight: '500' },
})
