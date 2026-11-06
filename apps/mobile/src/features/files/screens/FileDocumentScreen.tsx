import type { FileNode } from '@pulpo/contracts'
import { liveFormat, liveFormatOfName } from '@pulpo/client-core/office'
import { exportNotebookFile } from '@pulpo/client-core/office/notebook'
import { exportTextFile, textFileFacts } from '@pulpo/client-core/office/text'
import { describeHunkSummary } from '@pulpo/client-core/doc-editor/summary'
import { sessionColor, type DocSessionSnapshot, type DocSyncStatus } from '@pulpo/client-core/doc-sync'
import type { NativeStackHeaderItem, NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { StatusBar } from 'expo-status-bar'
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
import { useSessionStore } from '../../../store/session'
import { useAppTheme } from '../../../theme'
import { useDocSchemaSupported, useFilesEnabled } from '../availability'
import { FilesToastHost } from '../components/FilesToastHost'
import { FilesTurnedOff } from '../components/FilesTurnedOff'
import { FORMATTING_BAR_HEIGHT, FormattingBar } from '../components/FormattingBar'
import { FolderPickerSheet } from '../components/FolderPickerSheet'
import { accountDocSessions } from '../doc/accountSessions'
import type { DocHandle } from '../doc/sessions'
import type { EditorBridgeState } from '../editor/bridge'
import { editorBundleFor, type MobileEditorFormat } from '../editor/bundles'
import { docEditorAvailable, DocEditorView, type DocEditorHandle } from '../editor/DocEditorView'
import { NOTEBOOK_TOOLBAR, notebookToolbarState } from '../editor/notebookToolbar'
import { SHEET_TOOLBAR, sheetToolbarState } from '../editor/sheetToolbar'
import { TEXT_TOOLBAR, textToolbarState } from '../editor/textToolbar'
import { PRESENTATION_TOOLBAR, presentationToolbarState } from '../editor/presentationToolbar'
import type { PresentationCommand } from '../editor/protocol'
import { PRESENTATION_BAR_HEIGHT, PresentationBar } from '../components/PresentationBar'
import { apiUrl, nativeAuthorizationHeaders } from '../../../api/client'
import { DOCX_TOOLBAR, docxToolbarState } from '../editor/docxToolbar'
import { deviceSessionLabel } from '../editor/presentation'
import { fetchDocMarkdown, fetchFileAsset } from '../api'
import { filesErrorMessage } from '../display'
import { officeActions } from '../itemActions'
import { shareOfficePdf, useOfficeConversionEnabled } from '../officeConversion'
import { openFilesLinkInApp } from '../links'
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
  if (status.state === 'closed' && status.reason === 'converted') return { title: 'This is now an ordinary file', detail: 'It was renamed to another type of file.', action: 'back' }
  if (status.state === 'error') {
    switch (status.error) {
      case 'unauthorized': return { title: 'You can’t edit this document', detail: 'Files may have been turned off.', action: 'back' }
      case 'doc_too_large': return { title: 'This document is too large', detail: 'Edits can’t be saved until some content is removed on another device.', action: 'retry' }
      case 'not_found': return { title: 'This document was deleted', detail: 'It’s no longer in Files.', action: 'back' }
      case 'rate_limited': return null
      case 'stale_copy': return null
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
  const operations = useFileOperations(namespace)
  const officeConversionEnabled = useOfficeConversionEnabled()
  const [exportingPdf, setExportingPdf] = useState(false)
  const fileId = route.params.fileId
  const nodeQuery = useQuery({ ...fileNodeQuery(namespace, fileId), enabled: Boolean(namespace) && filesEnabled })
  const node = nodeQuery.data?.node
  const canExportPdf = Boolean(node && !node.trashedAt && officeActions(node, officeConversionEnabled).pdf)
  // The document's live format picks its editor; only Markdown has suggestions inline.
  const formatId = node?.format ?? 'markdown'
  const schemaSupported = useDocSchemaSupported(formatId) && Boolean(editorBundleFor(formatId))
  const editorFormat: MobileEditorFormat = formatId === 'text' || formatId === 'notebook' || formatId === 'presentation' || formatId === 'document' || formatId === 'sheet' ? formatId : 'markdown'
  const isText = editorFormat === 'text'
  const isNotebook = editorFormat === 'notebook'
  /** Formats other than Markdown keep their extension, have no inline suggestions, and fall back to their text. */
  const isLive = editorFormat !== 'markdown'
  const isDeck = editorFormat === 'presentation'
  const isWord = editorFormat === 'document'
  const isSheet = editorFormat === 'sheet'
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
    if (!namespace || !filesEnabled) return
    const held = accountDocSessions(namespace).acquire(fileId)
    setHandle(held)
    return () => {
      held.release()
      setHandle(null)
    }
  }, [fileId, filesEnabled, generation, namespace])
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
    const ready = editorState?.loaded && (isText ? editorState.text && !editorState.text.readOnly : isNotebook ? editorState.notebook && !editorState.notebook.readOnly : isWord ? editorState.docx?.editable : isSheet ? editorState.sheet && !editorState.sheet.readOnly : editorState.formatting?.editable)
    if (isDeck || !route.params.created || focusedNew.current || !ready) return
    focusedNew.current = true
    editor.current?.focus('start')
  }, [editorState, isDeck, isNotebook, isText, isWord, isSheet, route.params.created])

  // A copy of an earlier document under this id was dropped; start over without it.
  useEffect(() => {
    if (status.state === 'error' && status.error === 'stale_copy') restartSession()
  }, [restartSession, status])

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
  const inMemory = Boolean(handle && liveFormat(formatId)?.hasContent(handle.controller.doc))
  const usable = Boolean(session) && (loadedOnce || inMemory || status.state === 'synced' || status.state === 'syncing' || session?.hasCachedContent === true)
  const editable = filesEnabled && !problem && usable && node?.kind === 'doc' && docEditorAvailable
  const title = node?.name ?? route.params.name ?? 'Document'
  // Markdown documents read without their extension; code files keep theirs, which says what they are.
  const shownTitle = isLive ? title : title.replace(/\.(md|markdown)$/i, '')
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
    const text = (node.format ?? 'markdown') !== 'markdown'
    const submit = (name: string) => {
      if (!text) {
        void operations.rename(node, name.endsWith('.md') || name.endsWith('.markdown') ? name : `${name}.md`)
        return
      }
      // A name of another type turns the document into an ordinary file; say so first.
      if (liveFormatOfName(name)?.id === node.format) void operations.rename(node, name)
      else Alert.alert('Rename to another type?', `“${name}” is a different type of file, so it would become an ordinary file you can’t edit here.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rename', style: 'destructive', onPress: () => { void operations.rename(node, name) } },
      ])
    }
    const base = text ? node.name : node.name.replace(/\.(md|markdown)$/i, '')
    if (Platform.OS === 'ios') {
      Alert.prompt('Rename', text ? undefined : 'Documents keep their .md extension.', [
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
      // Decks export through the server, which holds their pictures.
      if (isDeck) {
        await shareFileItem(node)
        return
      }
      // An open editor exports its own copy, which includes edits not yet synced.
      if (isNotebook) {
        // The open copy includes edits not yet synced; without it (or its images) the server exports.
        let bytes: Uint8Array | undefined
        if (handle && usable) {
          const assets = { put: () => Promise.reject(new Error('Read only')), get: (hash: string) => fetchFileAsset(node.id, hash) }
          bytes = await exportNotebookFile(handle.controller.doc, { assets }).catch(() => undefined)
        }
        await shareFileItem(node, undefined, bytes)
        return
      }
      // Word documents export on the server, which holds their pictures and original parts.
      if (isWord) {
        await shareFileItem(node)
        return
      }
      if (isText) {
        // A file kept with its original bytes (mixed line breaks, a legacy encoding) is exported
        // exactly by the server, which holds them; while edits wait to sync, this copy has more.
        const serverExact = handle && textFileFacts(handle.controller.doc).original && status.state === 'synced'
        const bytes = handle && usable && !serverExact ? await exportTextFile(handle.controller.doc, { assets: { put: () => Promise.reject(new Error('Read only')), get: () => Promise.reject(new Error('Not on this device')) } }) : undefined
        await shareFileItem(node, undefined, bytes)
        return
      }
      // Spreadsheets are written by the server's codec, which the app doesn't ship; edits waiting to sync aren't in it yet.
      if (isSheet) {
        await shareFileItem(node)
        return
      }
      const markdown = editorState?.loaded ? await editor.current?.exportMarkdown() : undefined
      await shareFileItem(node, markdown)
    } catch (error) {
      operations.fail(error, node.name)
    }
  }, [editorState?.loaded, handle, isDeck, isNotebook, isText, isWord, isSheet, node, operations, status.state, usable])
  /** A deck's pictures, fetched for the editor page (which has no network of its own). */
  const fetchAsset = useCallback(async (hash: string) => {
    const url = apiUrl(`/api/files/${fileId}/assets/${hash}`)
    const response = await fetch(url, { headers: nativeAuthorizationHeaders(url) })
    if (!response.ok) throw new Error(`The picture could not be loaded (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }, [fileId])
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

  const exportPdf = useCallback(async () => {
    if (!node) return
    setExportingPdf(true)
    try { await shareOfficePdf(node) } catch (error) { operations.fail(error, node.name) }
    finally { setExportingPdf(false) }
  }, [node, operations])

  const menu: NativeStackHeaderItem = useMemo(() => ({
    type: 'menu',
    label: 'Document',
    icon: { type: 'sfSymbol', name: 'ellipsis' },
    identifier: 'doc-menu',
    menu: {
      items: [
        isNotebook
          ? { type: 'action', label: 'Clear All Outputs', icon: { type: 'sfSymbol', name: 'eye.slash' }, disabled: !editorState?.loaded || !editable, onPress: () => editor.current?.command('clearAllOutputs') }
          : isDeck
          ? { type: 'action', label: 'Present', icon: { type: 'sfSymbol', name: 'play.rectangle' }, disabled: !editorState?.loaded, onPress: () => editor.current?.command('present') }
          : { type: 'action', label: isText ? 'Find and Replace' : isSheet ? 'Find in Spreadsheet' : 'Find in Document', icon: { type: 'sfSymbol', name: 'magnifyingglass' }, disabled: !editorState?.loaded, onPress: () => { if (isText || isSheet) editor.current?.command('find'); else editor.current?.showFind() } },
        ...(canExportPdf ? [{ type: 'action' as const, label: 'Export as PDF', icon: { type: 'sfSymbol' as const, name: 'doc.text' as const }, disabled: exportingPdf, onPress: () => { void exportPdf() } }] : []),
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
  }), [canExportPdf, exportingPdf, exportPdf, editable, editorState?.loaded, exportDocument, isNotebook, isDeck, isText, isSheet, navigation, node, nodeQuery.data?.ancestors, operations, rename, trash])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: shownTitle,
      headerShown: Platform.OS === 'ios' && !presenting,
      headerLargeTitle: false,
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' && filesEnabled ? () => [
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
  const reviewVisible = !isLive && Boolean(suggestions?.count) && !keyboardVisible && editorState?.loaded
  const reviewBarHeight = reviewVisible ? 116 : 0
  // Android draws its formatting bar above the keyboard; the editor keeps the caret clear of it.
  const formattingBarVisible = Platform.OS === 'android' && keyboardVisible && editable && Boolean(editorState?.loaded)
  // A running slide show gets the whole screen: no header, status bar, or deck bar.
  const presenting = isDeck && editorState?.presentation?.presenting === true
  const presentationBarVisible = isDeck && editable && Boolean(editorState?.loaded) && !presenting
  const navigationBarPadding = Platform.OS === 'android' && isSheet && !keyboardVisible ? insets.bottom : 0
  const editorBottomPadding = reviewBarHeight + (formattingBarVisible && !isDeck ? FORMATTING_BAR_HEIGHT : 0) + (presentationBarVisible ? PRESENTATION_BAR_HEIGHT + insets.bottom : 0) + navigationBarPadding
  const showAndroidMenu = () => showActions(title, [
    ...(isDeck ? [{ label: 'Present', icon: 'play.rectangle', onPress: () => editor.current?.command('present') }] : []),
    ...(canExportPdf ? [{ label: 'Export as PDF', icon: 'doc.text', disabled: exportingPdf, onPress: () => { void exportPdf() } }] : []),
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
        {isLive
          ? <Text selectable style={[isWord ? null : styles.code, { color: theme.text }]}>{fallback.data.markdown}</Text>
          : <SafeMarkdown>{fallback.data.markdown}</SafeMarkdown>}
      </ScrollView>
    ) : fallback.isError || (!fallback.isFetching && !fallback.data) ? (
      <View style={styles.center}>
        <SymbolView name="icloud.slash" size={40} tintColor={theme.tertiary} />
        <Text style={[styles.centerTitle, { color: theme.text }]}>Not available offline</Text>
        <Text style={[styles.centerBody, { color: theme.secondary }]}>Open this document once while connected to keep a copy on this device.</Text>
      </View>
    ) : <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>
    // The node says which editor the document needs; wait for it rather than guess Markdown.
  ) : handle && session && node ? (
    <DocEditorView
      key={`${generation}:${editorFormat}`}
      ref={editor}
      format={editorFormat}
      name={node?.name}
      docId={fileId}
      acquire={() => accountDocSessions(namespace).acquire(fileId)}
      editable={editable}
      placeholder="Start writing…"
      sessionLabel={deviceSessionLabel()}
      sessionColor={sessionColor(handle.controller.doc.clientID)}
      bottomPadding={editorBottomPadding}
      pageBackground={presenting ? '#000000' : undefined}
      style={styles.flex}
      onStateChange={setEditorState}
      onResolved={onResolved}
      fetchAsset={fetchAsset}
      onLink={(href) => {
        // Files links on this instance open here, as on the web.
        if (openFilesLinkInApp(href, useSessionStore.getState().instanceUrl)) return
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

  if (!filesEnabled) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
        {Platform.OS === 'android' ? <PageHeader title={shownTitle} onBack={() => navigation.goBack()} /> : null}
        <FilesTurnedOff />
      </View>
    )
  }

  return (
    <View style={[styles.flex, { backgroundColor: presenting ? '#000' : theme.isDark ? theme.background : theme.elevated, paddingTop: Platform.OS === 'android' && !presenting ? insets.top : 0 }]}>
      {presenting ? <StatusBar hidden style="light" /> : null}
      {Platform.OS === 'android' && !presenting ? (
        <PageHeader
          title={shownTitle}
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
        formatting={isText ? (editorState?.text ? textToolbarState(editorState) : null) : isNotebook ? (editorState?.notebook ? notebookToolbarState(editorState) : null) : isWord ? (editorState?.docx ? docxToolbarState(editorState) : null) : isSheet ? (editorState?.sheet ? sheetToolbarState(editorState) : null) : editorState?.formatting ?? null}
        items={isText ? TEXT_TOOLBAR : isNotebook ? NOTEBOOK_TOOLBAR : isWord ? DOCX_TOOLBAR : isSheet ? SHEET_TOOLBAR : undefined}
        visible={formattingBarVisible && !isDeck}
        onCommand={(command) => editor.current?.toolbar(command as never)}
        onDismissKeyboard={() => editor.current?.dismissKeyboard()}
      />
      <PresentationBar
        items={PRESENTATION_TOOLBAR}
        state={editorState ? presentationToolbarState(editorState) : { active: [], disabled: [] }}
        visible={presentationBarVisible}
        onCommand={(command) => editor.current?.command(command as PresentationCommand)}
      />
      {presenting ? (
        <Pressable
          accessibilityLabel="End Slide Show"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => editor.current?.command('endShow')}
          style={[styles.endShow, { top: insets.top + 8 }]}
          testID="end-slide-show"
        >
          <SymbolView name="xmark" size={14} tintColor="#fff" />
        </Pressable>
      ) : null}
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
          sourceFolderIds={[node.parentId]}
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
  endShow: { position: 'absolute', right: 16, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  centerTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  centerBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  fallback: { paddingHorizontal: 20, paddingTop: 12 },
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, lineHeight: 19 },
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
