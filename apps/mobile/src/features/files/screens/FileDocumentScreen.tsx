import type { FileNode } from '@pulpo/contracts'
import { describeHunkSummary } from '@pulpo/client-core/doc-editor/summary'
import { sessionColor, type DocSessionSnapshot, type DocSyncStatus } from '@pulpo/client-core/doc-sync'
import type { NativeStackHeaderItem, NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Alert, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeMarkdown } from '../../../components/SafeMarkdown'
import { PageHeader } from '../../../mockup5/src/components/PrototypeUI'
import { showActions } from '../../../platform/materialActions'
import { MaterialIconButton } from '../../../platform/MaterialUI'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { promptText } from '../../../platform/materialActions'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { useDocSchemaSupported, useFilesEnabled } from '../availability'
import { FilesToastHost } from '../components/FilesToastHost'
import { FORMATTING_BAR_HEIGHT, FormattingBar } from '../components/FormattingBar'
import { FolderPickerSheet } from '../components/FolderPickerSheet'
import { accountDocSessions } from '../doc/accountSessions'
import type { DocHandle } from '../doc/sessions'
import type { EditorBridgeState } from '../editor/bridge'
import { docEditorAvailable, DocEditorView, type DocEditorHandle } from '../editor/DocEditorView'
import { deviceSessionLabel } from '../editor/presentation'
import { fetchDocMarkdown } from '../api'
import { filesErrorMessage } from '../display'
import { shareFileItem } from '../open'
import { useFileOperations } from '../operations'
import { fileNodeQuery, filesQueryKeys } from '../queries'
import { useFilesNamespace } from '../useFilesNamespace'

type Props = NativeStackScreenProps<RootStackParamList, 'FileDocument'>

const CLOSED: DocSessionSnapshot = { session: null, status: { state: 'connecting' }, peers: [] }
const noSubscription = () => () => {}

/** What keeps a document from being edited, if anything, and what the user can do about it. */
type Problem = { title: string; detail: string; action?: 'restore' | 'retry' | 'back' | 'update' }

function documentProblem(status: DocSyncStatus, node: FileNode | undefined, schemaSupported: boolean): Problem | null {
  if (!schemaSupported || (status.state === 'error' && status.error === 'schema_outdated')) {
    return { title: 'Update Pulpo to edit this document', detail: 'This version of the app can’t edit documents from this server. You can still read it.', action: 'update' }
  }
  if (node?.trashedAt || (status.state === 'closed' && status.reason === 'trashed')) {
    return { title: 'This document is in the trash', detail: 'Restore it to edit it again.', action: 'restore' }
  }
  if (status.state === 'closed' && status.reason === 'deleted') return { title: 'This document was deleted', detail: 'It’s no longer in Files.', action: 'back' }
  if (status.state === 'closed' && status.reason === 'converted') return { title: 'This is now an ordinary file', detail: 'It was renamed without a Markdown extension.', action: 'back' }
  if (status.state === 'error') {
    switch (status.error) {
      case 'unauthorized': return { title: 'You can’t edit this document', detail: 'Files may have been turned off.', action: 'back' }
      case 'doc_too_large': return { title: 'This document is too large', detail: 'Edits can’t be saved until some content is removed on another device.', action: 'retry' }
      case 'not_found': return { title: 'This document was deleted', detail: 'It’s no longer in Files.', action: 'back' }
      case 'rate_limited': return null
      default: return { title: 'Changes aren’t being saved', detail: 'Pulpo couldn’t sync this document. Your edits are kept on this device.', action: 'retry' }
    }
  }
  return null
}

function SyncIndicator({ status }: { status: DocSyncStatus }) {
  const theme = useAppTheme()
  const state = status.state
  const { symbol, label, color } = state === 'synced'
    ? { symbol: 'checkmark.icloud', label: 'Saved', color: theme.secondary }
    : state === 'syncing' || state === 'connecting'
      ? { symbol: 'arrow.triangle.2.circlepath.icloud', label: 'Saving…', color: theme.secondary }
      : state === 'offline'
        ? { symbol: 'icloud.slash', label: 'Offline: edits are saved on this device', color: theme.orange }
        : { symbol: 'exclamationmark.icloud', label: 'Not saving', color: theme.red }
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="text" style={styles.syncIndicator} testID={`doc-sync-${state}`}>
      <SymbolView name={symbol as never} size={20} tintColor={color} />
    </View>
  )
}

export function FileDocumentScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const schemaSupported = useDocSchemaSupported()
  const operations = useFileOperations(namespace)
  const fileId = route.params.fileId
  const nodeQuery = useQuery({ ...fileNodeQuery(namespace, fileId), enabled: Boolean(namespace) && filesEnabled })
  const node = nodeQuery.data?.node
  const editor = useRef<DocEditorHandle>(null)
  const [handle, setHandle] = useState<DocHandle | null>(null)
  const [editorState, setEditorState] = useState<EditorBridgeState | null>(null)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [moving, setMoving] = useState(false)
  const recountPending = useRef(false)

  // One hold on the session for this screen's status and presence; the editor takes its own.
  // `generation` starts a fresh session (after a restore, or to retry a failed one).
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!namespace) return
    const held = accountDocSessions(namespace).acquire(fileId)
    setHandle(held)
    return () => held.release()
  }, [fileId, generation, namespace])
  const restartSession = useCallback(() => {
    accountDocSessions(namespace).restart(fileId)
    setEditorState(null)
    setGeneration((current) => current + 1)
  }, [fileId, namespace])
  const snapshot = useSyncExternalStore(handle?.controller.subscribe ?? noSubscription, handle?.controller.getSnapshot ?? (() => CLOSED))
  const { status, peers, session } = snapshot

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])

  // A review in the editor changes replies' suggestion counts once the server has it.
  useEffect(() => {
    if (status.state !== 'synced' || !recountPending.current) return
    recountPending.current = false
    void queryClient.invalidateQueries({ queryKey: filesQueryKeys.changes(namespace) })
  }, [namespace, queryClient, status])
  const onResolved = useCallback(() => {
    recountPending.current = true
  }, [])

  // A document just created opens ready to type in, once.
  const focusedNew = useRef(false)
  useEffect(() => {
    if (!route.params.created || focusedNew.current || !editorState?.loaded || !editorState.formatting?.editable) return
    focusedNew.current = true
    editor.current?.focus('start')
  }, [editorState?.formatting?.editable, editorState?.loaded, route.params.created])

  // A document turned into an ordinary file opens as one.
  useEffect(() => {
    if (status.state === 'closed' && status.reason === 'converted') void nodeQuery.refetch()
  }, [nodeQuery, status])

  // Once this session has the document (from the server or this device's copy), it stays usable
  // through disconnects: edits made meanwhile are kept on the device and uploaded later.
  const [loadedOnce, setLoadedOnce] = useState(false)
  useEffect(() => {
    if (session && (status.state === 'synced' || status.state === 'syncing' || session.hasCachedContent)) setLoadedOnce(true)
  }, [session, status.state])
  useEffect(() => { setLoadedOnce(false) }, [handle])
  const problem = documentProblem(status, node, schemaSupported)
  // A session still in memory from earlier (e.g. lingering after closing) holds the document too.
  const inMemory = Boolean(handle && handle.controller.doc.getXmlFragment('default').length > 0)
  const usable = Boolean(session) && (loadedOnce || inMemory || status.state === 'synced' || status.state === 'syncing' || session?.hasCachedContent === true)
  const editable = filesEnabled && !problem && usable && node?.kind === 'doc' && docEditorAvailable
  const title = node?.name ?? route.params.name ?? 'Document'
  // Without a usable copy (an outdated app, or offline before the first sync) the server's Markdown is shown.
  const readOnlyFallback = !docEditorAvailable || (!usable && (problem?.action === 'update' || status.state === 'offline'))
  const fallback = useQuery({
    queryKey: [...filesQueryKeys.node(namespace, fileId), 'markdown'],
    queryFn: () => fetchDocMarkdown(fileId),
    enabled: readOnlyFallback && Boolean(namespace) && filesEnabled,
    retry: false,
  })

  const rename = useCallback(() => {
    if (!node) return
    const submit = (name: string) => { void operations.rename(node, name.endsWith('.md') || name.endsWith('.markdown') ? name : `${name}.md`) }
    const base = node.name.replace(/\.(md|markdown)$/i, '')
    if (Platform.OS === 'ios') {
      Alert.prompt('Rename', 'Documents keep their .md extension.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rename', isPreferred: true, onPress: (value?: string) => { if (value?.trim()) submit(value.trim()) } },
      ], 'plain-text', base)
    } else {
      promptText({ title: 'Rename', value: base, confirmLabel: 'Rename', onSubmit: (value) => { if (value.trim()) submit(value.trim()) } })
    }
  }, [node, operations])
  const exportDocument = useCallback(async () => {
    if (!node) return
    try {
      // An open editor exports its own copy, which includes edits not yet synced.
      const markdown = editorState?.loaded ? await editor.current?.exportMarkdown() : undefined
      await shareFileItem(node, markdown)
    } catch (error) {
      operations.fail(error, node.name)
    }
  }, [editorState?.loaded, node, operations])
  const trash = useCallback(() => {
    if (!node) return
    Alert.alert(`Move “${node.name}” to the trash?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move to Trash', style: 'destructive', onPress: () => {
        void operations.trash([node]).then((done) => {
          if (!done) return
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          navigation.goBack()
        })
      } },
    ])
  }, [navigation, operations, node])

  const menu: NativeStackHeaderItem = useMemo(() => ({
    type: 'menu',
    label: 'Document',
    icon: { type: 'sfSymbol', name: 'ellipsis' },
    identifier: 'doc-menu',
    menu: {
      items: [
        { type: 'action', label: 'Find in Document', icon: { type: 'sfSymbol', name: 'magnifyingglass' }, disabled: !editorState?.loaded, onPress: () => editor.current?.showFind() },
        { type: 'action', label: 'Export…', icon: { type: 'sfSymbol', name: 'square.and.arrow.up' }, disabled: !node, onPress: () => { void exportDocument() } },
        {
          type: 'submenu',
          label: 'Organize',
          inline: true,
          items: [
            { type: 'action', label: 'Rename', icon: { type: 'sfSymbol', name: 'pencil' }, disabled: !node || Boolean(node.trashedAt), onPress: rename },
            { type: 'action', label: 'Move…', icon: { type: 'sfSymbol', name: 'folder' }, disabled: !node || Boolean(node.trashedAt), onPress: () => setMoving(true) },
            { type: 'action', label: 'Duplicate', icon: { type: 'sfSymbol', name: 'plus.square.on.square' }, disabled: !node, onPress: () => { if (node) void operations.duplicate([node], node.parentId) } },
            { type: 'action', label: node?.pinned ? 'Unpin' : 'Pin', icon: { type: 'sfSymbol', name: node?.pinned ? 'pin.slash' : 'pin' }, disabled: !node, onPress: () => { if (node) void operations.setPinned([node], !node.pinned) } },
            { type: 'action', label: 'Show in Folder', icon: { type: 'sfSymbol', name: 'folder.badge.questionmark' }, disabled: !node, onPress: () => { if (node) navigation.push('FilesFolder', { folderId: node.parentId, name: nodeQuery.data?.ancestors.at(-1)?.name }) } },
          ],
        },
        { type: 'action', label: 'Move to Trash', icon: { type: 'sfSymbol', name: 'trash' }, destructive: true, disabled: !node || Boolean(node.trashedAt), onPress: trash },
      ],
    },
  }), [editorState?.loaded, exportDocument, navigation, node, nodeQuery.data?.ancestors, operations, rename, trash])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title.replace(/\.(md|markdown)$/i, ''),
      headerShown: Platform.OS === 'ios',
      headerLargeTitle: false,
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' ? () => [
        ...(peers.length ? [{
          type: 'custom' as const,
          hidesSharedBackground: true,
          element: (
            <View accessible accessibilityLabel={`Also open on ${peers.map((peer) => peer.name).join(', ')}`} style={styles.peers}>
              {peers.slice(0, 3).map((peer) => <View key={peer.clientId} style={[styles.peer, { backgroundColor: peer.color, borderColor: theme.background }]} />)}
              {peers.length > 3 ? <Text style={[styles.peerMore, { color: theme.secondary }]}>+{peers.length - 3}</Text> : null}
            </View>
          ),
        }] : []),
        { type: 'custom', hidesSharedBackground: true, element: <SyncIndicator status={status} /> },
        menu,
      ] : undefined,
    })
  })

  const suggestions = editorState?.suggestions
  const reviewVisible = Boolean(suggestions?.count) && !keyboardVisible && editorState?.loaded
  const reviewBarHeight = reviewVisible ? 116 : 0
  // Android draws its formatting bar above the keyboard; the editor keeps the caret clear of it.
  const formattingBarVisible = Platform.OS === 'android' && keyboardVisible && editable && Boolean(editorState?.loaded)
  const editorBottomPadding = reviewBarHeight + (formattingBarVisible ? FORMATTING_BAR_HEIGHT : 0)
  const showAndroidMenu = () => showActions(title, [
    { label: 'Export', icon: 'square.and.arrow.up', onPress: () => { void exportDocument() } },
    { label: 'Rename', icon: 'pencil', onPress: rename },
    { label: 'Move', icon: 'folder', onPress: () => setMoving(true) },
    { label: 'Duplicate', icon: 'plus.square.on.square', onPress: () => { if (node) void operations.duplicate([node], node.parentId) } },
    { label: node?.pinned ? 'Unpin' : 'Pin', icon: node?.pinned ? 'pin.slash' : 'pin', onPress: () => { if (node) void operations.setPinned([node], !node.pinned) } },
    { label: 'Show in folder', icon: 'folder.badge.questionmark', onPress: () => { if (node) navigation.push('FilesFolder', { folderId: node.parentId, name: nodeQuery.data?.ancestors.at(-1)?.name }) } },
    { label: 'Move to trash', icon: 'trash', destructive: true, onPress: trash },
  ])

  const banner = (() => {
    if (problem) {
      return (
        <View style={[styles.banner, { backgroundColor: theme.fill }]} testID="doc-problem">
          <View style={styles.flex}>
            <Text style={[styles.bannerTitle, { color: theme.text }]}>{problem.title}</Text>
            <Text style={[styles.bannerDetail, { color: theme.secondary }]}>{problem.detail}</Text>
          </View>
          {problem.action === 'restore' && node ? <Pressable accessibilityRole="button" onPress={() => { void operations.restore([node]).then(() => nodeQuery.refetch()).then(restartSession) }}><Text style={[styles.bannerAction, { color: theme.blue }]}>Restore</Text></Pressable> : null}
          {problem.action === 'retry' ? <Pressable accessibilityRole="button" onPress={restartSession}><Text style={[styles.bannerAction, { color: theme.blue }]}>Retry</Text></Pressable> : null}
          {problem.action === 'back' ? <Pressable accessibilityRole="button" onPress={() => navigation.goBack()}><Text style={[styles.bannerAction, { color: theme.blue }]}>Close</Text></Pressable> : null}
        </View>
      )
    }
    if (node?.suggestion) {
      return (
        <View style={[styles.banner, { backgroundColor: theme.fill }]}>
          <SymbolView name="sparkles" size={16} tintColor={theme.green} />
          <Text style={[styles.flex, styles.bannerDetail, { color: theme.text }]}>The agent suggested this document.</Text>
          <Pressable accessibilityRole="button" onPress={() => { void operations.resolveSuggestion(node, 'accept').then(() => nodeQuery.refetch()) }}><Text style={[styles.bannerAction, { color: theme.blue }]}>Keep</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => Alert.alert(`Remove “${node.name}”?`, 'The agent suggested this document. Removing it deletes it.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => { void operations.resolveSuggestion(node, 'reject').then((result) => { if (result === null) navigation.goBack() }) } },
          ])}><Text style={[styles.bannerAction, { color: theme.red }]}>Remove</Text></Pressable>
        </View>
      )
    }
    return null
  })()

  const body = readOnlyFallback ? (
    fallback.data ? (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.fallback, { paddingBottom: insets.bottom + 24 }]}>
        <SafeMarkdown>{fallback.data.markdown}</SafeMarkdown>
      </ScrollView>
    ) : fallback.isError || (!fallback.isFetching && !fallback.data) ? (
      <View style={styles.center}>
        <SymbolView name="icloud.slash" size={40} tintColor={theme.tertiary} />
        <Text style={[styles.centerTitle, { color: theme.text }]}>Not available offline</Text>
        <Text style={[styles.centerBody, { color: theme.secondary }]}>Open this document once while connected to keep a copy on this device.</Text>
      </View>
    ) : <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>
  ) : handle && session ? (
    <DocEditorView
      key={generation}
      ref={editor}
      acquire={() => accountDocSessions(namespace).acquire(fileId)}
      editable={editable}
      placeholder="Start writing…"
      sessionLabel={deviceSessionLabel()}
      sessionColor={sessionColor(handle.controller.doc.clientID)}
      bottomPadding={editorBottomPadding}
      style={styles.flex}
      onStateChange={setEditorState}
      onResolved={onResolved}
      onLink={(href) => {
        if (/^https?:/i.test(href)) void WebBrowser.openBrowserAsync(href).catch(() => undefined)
        else if (/^mailto:/i.test(href)) void Linking.openURL(href).catch(() => undefined)
      }}
    />
  ) : (
    <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>
  )

  const reviewBar = reviewVisible && suggestions ? (
    <View style={[styles.reviewBar, { bottom: insets.bottom + 10, backgroundColor: theme.elevated, borderColor: theme.separator }]} testID="doc-review-bar">
      <View style={styles.reviewHeader}>
        <Text style={[styles.reviewCount, { color: theme.secondary }]}>
          {suggestions.index !== null ? `Suggestion ${suggestions.index + 1} of ${suggestions.count}` : `${suggestions.count} ${suggestions.count === 1 ? 'suggestion' : 'suggestions'}`}
        </Text>
        <View style={styles.reviewNav}>
          <Pressable accessibilityLabel="Previous suggestion" accessibilityRole="button" hitSlop={8} onPress={() => editor.current?.review('previous')}><SymbolView name="chevron.up" size={17} tintColor={theme.blue} /></Pressable>
          <Pressable accessibilityLabel="Next suggestion" accessibilityRole="button" hitSlop={8} onPress={() => editor.current?.review('next')}><SymbolView name="chevron.down" size={17} tintColor={theme.blue} /></Pressable>
        </View>
      </View>
      <Text numberOfLines={2} style={[styles.reviewDescription, { color: theme.text }]}>
        {suggestions.active ? describeHunkSummary(suggestions.active.summary) : 'Tap a suggestion, or step through them.'}
      </Text>
      {editable ? (
        <View style={styles.reviewActions}>
          <Pressable accessibilityRole="button" disabled={!suggestions.active} onPress={() => { Haptics.selectionAsync(); editor.current?.review('reject') }} style={[styles.reviewButton, { backgroundColor: theme.fill, opacity: suggestions.active ? 1 : 0.4 }]} testID="doc-review-reject">
            <SymbolView name="xmark" size={14} tintColor={theme.red} /><Text style={[styles.reviewButtonLabel, { color: theme.red }]}>Reject</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!suggestions.active} onPress={() => { Haptics.selectionAsync(); editor.current?.review('accept') }} style={[styles.reviewButton, { backgroundColor: theme.fill, opacity: suggestions.active ? 1 : 0.4 }]} testID="doc-review-accept">
            <SymbolView name="checkmark" size={14} tintColor={theme.green} /><Text style={[styles.reviewButtonLabel, { color: theme.green }]}>Accept</Text>
          </Pressable>
          <Pressable accessibilityLabel="Review all suggestions" accessibilityRole="button" onPress={() => Alert.alert('All suggestions', `${suggestions.count} ${suggestions.count === 1 ? 'suggestion' : 'suggestions'} in this document.`, [
            { text: 'Accept All', onPress: () => editor.current?.review('acceptAll') },
            { text: 'Reject All', style: 'destructive', onPress: () => editor.current?.review('rejectAll') },
            { text: 'Cancel', style: 'cancel' },
          ])} style={[styles.reviewButton, { backgroundColor: theme.fill }]} testID="doc-review-all">
            <SymbolView name="checklist" size={14} tintColor={theme.blue} /><Text style={[styles.reviewButtonLabel, { color: theme.blue }]}>All…</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  ) : null

  return (
    <View style={[styles.flex, { backgroundColor: theme.isDark ? theme.background : theme.elevated, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
      {Platform.OS === 'android' ? (
        <PageHeader
          title={title.replace(/\.(md|markdown)$/i, '')}
          onBack={() => navigation.goBack()}
          right={<View style={styles.androidActions}>
            <SyncIndicator status={status} />
            <MaterialIconButton icon="ellipsis" label="Document" onPress={showAndroidMenu} />
          </View>}
        />
      ) : null}
      {banner}
      {Platform.OS === 'android' ? <KeyboardAvoidingView behavior="padding" style={styles.flex}>{body}</KeyboardAvoidingView> : body}
      <FormattingBar
        formatting={editorState?.formatting ?? null}
        visible={formattingBarVisible}
        onCommand={(command) => editor.current?.toolbar(command)}
        onDismissKeyboard={() => editor.current?.dismissKeyboard()}
      />
      {reviewBar}
      <FilesToastHost bottomOffset={reviewBarHeight} />
      {moving && node ? (
        <FolderPickerSheet
          namespace={namespace}
          mode="destination"
          title={`Move “${node.name}”`}
          confirmLabel="Move Here"
          initialFolderId={node.parentId}
          excludeIds={[node.id]}
          onCancel={() => setMoving(false)}
          onConfirm={(destination) => {
            setMoving(false)
            void operations.move([node], destination).then(() => nodeQuery.refetch())
          }}
        />
      ) : null}
      {nodeQuery.isError && !node ? <Text style={[styles.error, { color: theme.secondary }]}>{filesErrorMessage(nodeQuery.error)}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  centerTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  centerBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  fallback: { paddingHorizontal: 20, paddingTop: 12 },
  syncIndicator: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  androidActions: { flexDirection: 'row', alignItems: 'center' },
  peers: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  peer: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginLeft: -4 },
  peerMore: { fontSize: 12, marginLeft: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8, marginBottom: 4, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  bannerTitle: { fontSize: 15, fontWeight: '600' },
  bannerDetail: { fontSize: 14, lineHeight: 19 },
  bannerAction: { fontSize: 15, fontWeight: '600', paddingHorizontal: 4 },
  reviewBar: { position: 'absolute', left: 12, right: 12, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12, gap: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewCount: { fontSize: 13, fontWeight: '500' },
  reviewNav: { flexDirection: 'row', gap: 18 },
  reviewDescription: { fontSize: 15, lineHeight: 20 },
  reviewActions: { flexDirection: 'row', gap: 8 },
  reviewButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingVertical: 9 },
  reviewButtonLabel: { fontSize: 15, fontWeight: '600' },
  error: { textAlign: 'center', padding: 16 },
})
