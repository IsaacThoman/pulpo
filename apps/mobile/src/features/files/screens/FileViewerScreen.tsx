import { declaredDelimiter } from '@pulpo/client-core/files'
import { findInLines } from '@pulpo/client-core/highlight'
import { indexDelimited } from '@pulpo/client-core/office/delimited'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { File } from 'expo-file-system'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassIconButton, PageHeader, PrimaryButton, Segmented } from '../../../mockup5/src/components/PrototypeUI'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { MaterialIconButton } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { downloadFile } from '../api'
import { useFilesEnabled } from '../availability'
import { FilesTurnedOff } from '../components/FilesTurnedOff'
import { filesErrorMessage } from '../display'
import { previewUploadedFile, shareFileItem } from '../open'
import { fileNodeQuery, filesQueryKeys } from '../queries'
import { useFilesNamespace } from '../useFilesNamespace'
import { CodeView, type CodeViewHandle } from '../viewers/CodeView'
import { decodeFileText, formattedJson, inAppViewer, MAX_IN_APP_VIEWER_BYTES, viewerLines } from '../viewers/content'
import { GridView, MAX_NATIVE_GRID_COLUMNS, type GridViewHandle } from '../viewers/GridView'

type Props = NativeStackScreenProps<RootStackParamList, 'FileViewer'>

const MAX_MATCHES = 5_000

function FindBar({ query, onChange, current, total, onStep, onClose }: {
  query: string
  onChange: (query: string) => void
  current: number
  total: number
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}) {
  const theme = useAppTheme()
  const button = (icon: string, label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.findButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <SymbolView name={icon as never} size={18} tintColor={theme.blue} />
    </Pressable>
  )
  return (
    <View style={[styles.findBar, { borderBottomColor: theme.separator, backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
      <View style={[styles.findField, { backgroundColor: theme.fillStrong }]}>
        <SymbolView name="magnifyingglass" size={15} tintColor={theme.secondary} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={onChange}
          onSubmitEditing={() => onStep(1)}
          submitBehavior="submit"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="Find"
          placeholderTextColor={theme.tertiary}
          accessibilityLabel="Find"
          style={[styles.findInput, { color: theme.text }]}
        />
        {query ? <Text style={[styles.findCount, { color: theme.secondary }]}>{total ? `${current + 1} of ${total.toLocaleString()}${total >= MAX_MATCHES ? '+' : ''}` : 'No results'}</Text> : null}
      </View>
      {button('chevron.up', 'Previous match', () => onStep(-1), total === 0)}
      {button('chevron.down', 'Next match', () => onStep(1), total === 0)}
      <Pressable accessibilityRole="button" onPress={onClose} hitSlop={6}><Text style={[styles.findDone, { color: theme.blue }]}>Done</Text></Pressable>
    </View>
  )
}

function ToolbarToggle({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useAppTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: selected ? theme.accent : theme.fillStrong, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.chipText, { color: selected ? theme.accentText : theme.text }]}>{label}</Text>
    </Pressable>
  )
}

/**
 * CSV/TSV, code, and text files read in the app: a native grid for tables (with the text one tap
 * away) and highlighted code with line numbers, wrapping, find, and copy. Opens files from Files
 * and chat attachments already on the device.
 */
export function FileViewerScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const fileId = 'fileId' in route.params ? route.params.fileId : null
  const uri = 'uri' in route.params ? route.params.uri : null
  const nodeQuery = useQuery({ ...fileNodeQuery(namespace, fileId ?? ''), enabled: Boolean(namespace && fileId) && filesEnabled })
  const node = nodeQuery.data?.node
  const name = node?.name ?? route.params.name ?? 'File'
  const mimeType = node?.mimeType ?? ('mimeType' in route.params ? route.params.mimeType : undefined)
  // Opened through a shortcut, the size is only known here; such files go to the system viewer.
  const tooLarge = Boolean(node && node.sizeBytes > MAX_IN_APP_VIEWER_BYTES)
  const content = useQuery({
    queryKey: fileId ? [...filesQueryKeys.node(namespace, fileId), 'text', node?.updatedAt ?? ''] : ['viewer-file', uri],
    queryFn: async () => decodeFileText(await (fileId ? await downloadFile(node!) : new File(uri!)).bytes()),
    enabled: fileId ? node?.kind === 'blob' && filesEnabled && !tooLarge : true,
  })
  const text = content.data
  const viewer = inAppViewer(name, mimeType) ?? 'text'
  const table = useMemo(() => {
    if (text === undefined || viewer !== 'table') return null
    const indexed = indexDelimited(text, { declared: declaredDelimiter(name, mimeType) ?? ',' })
    return indexed.columnCount >= 2 ? indexed : null
  }, [mimeType, name, text, viewer])
  const [mode, setMode] = useState<'table' | 'text'>('table')
  const showGrid = Boolean(table) && mode === 'table'
  const [wrap, setWrap] = useState(false)
  const formatted = useMemo(() => (text === undefined ? null : formattedJson(text, name, mimeType)), [mimeType, name, text])
  const [showFormatted, setShowFormatted] = useState(true)
  const shown = formatted !== null && showFormatted ? formatted : text ?? ''
  const isNotebookSource = viewer === 'notebook'
  const lines = useMemo(() => (showGrid ? null : viewerLines(shown, name, mimeType, viewer === 'table' ? null : isNotebookSource ? 'json' : undefined)), [isNotebookSource, mimeType, name, showGrid, shown, viewer])

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const lineMatches = useMemo(() => (findOpen && lines ? findInLines(lines.plain, query, MAX_MATCHES) : []), [findOpen, lines, query])
  const rowMatches = useMemo(() => (findOpen && showGrid && table && query ? table.findRows(query, MAX_MATCHES) : []), [findOpen, query, showGrid, table])
  const matchRowSet = useMemo(() => new Set(rowMatches), [rowMatches])
  const total = showGrid ? rowMatches.length : lineMatches.length
  const codeRef = useRef<CodeViewHandle>(null)
  const gridRef = useRef<GridViewHandle>(null)
  const reveal = (index: number) => {
    if (showGrid) {
      const row = rowMatches[index]
      if (row !== undefined) gridRef.current?.scrollToRow(row)
    } else {
      const match = lineMatches[index]
      if (match) codeRef.current?.scrollToMatch(match)
    }
  }
  // A new query (or view) starts again at its first match, which may be off screen.
  useEffect(() => {
    if (showGrid) {
      const row = rowMatches[0]
      if (row !== undefined) gridRef.current?.scrollToRow(row)
    } else {
      const match = lineMatches[0]
      if (match) codeRef.current?.scrollToMatch(match)
    }
  }, [lineMatches, rowMatches, showGrid])
  const step = (direction: 1 | -1) => {
    if (!total) return
    const next = (current + direction + total) % total
    setCurrent(next)
    reveal(next)
  }

  const share = node && filesEnabled ? () => {
    void shareFileItem(node).catch((error) => Alert.alert('Couldn’t share', filesErrorMessage(error)))
  } : null
  const openFind = () => setFindOpen(true)

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerShown: Platform.OS === 'ios',
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' && text !== undefined ? () => [
        { type: 'button', label: 'Find', icon: { type: 'sfSymbol', name: 'magnifyingglass' }, onPress: openFind },
        ...(share ? [{ type: 'button' as const, label: 'Share', icon: { type: 'sfSymbol' as const, name: 'square.and.arrow.up' as const }, onPress: share }] : []),
      ] : undefined,
    })
  })

  const unavailable = Boolean(fileId) && !filesEnabled
  const status = showGrid && table
    ? `${table.rowCount.toLocaleString()} rows · ${table.columnCount.toLocaleString()} columns${table.columnCount > MAX_NATIVE_GRID_COLUMNS ? ` (first ${MAX_NATIVE_GRID_COLUMNS} shown)` : ''}`
    : lines ? `${lines.plain.length.toLocaleString()} ${lines.plain.length === 1 ? 'line' : 'lines'}` : ''

  return (
    // Kept clear of side insets too: on foldables the status bar is a column at the side.
    <View style={[styles.flex, { backgroundColor: theme.isDark ? theme.background : theme.elevated, paddingTop: Platform.OS === 'android' ? insets.top : 0, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {Platform.OS === 'android' ? (
        <PageHeader
          title={name}
          onBack={() => navigation.goBack()}
          right={text !== undefined ? (
            <View style={styles.headerButtons}>
              <MaterialIconButton icon="magnifyingglass" label="Find" onPress={openFind} />
              {share ? <MaterialIconButton icon="square.and.arrow.up" label="Share" onPress={share} /> : null}
            </View>
          ) : null}
        />
      ) : null}
      {unavailable ? <FilesTurnedOff /> : tooLarge && node ? (
        <View style={styles.center}>
          <SymbolView name="doc.text.magnifyingglass" size={36} tintColor={theme.tertiary} />
          <Text style={[styles.centerText, { color: theme.secondary }]}>This file is too large to show in Pulpo.</Text>
          <PrimaryButton label="Open in Another App" variant="secondary" onPress={() => { void previewUploadedFile(node).catch((error) => Alert.alert('Couldn’t open', filesErrorMessage(error))) }} />
        </View>
      ) : text !== undefined ? (
        <>
          {findOpen ? (
            <FindBar
              query={query}
              onChange={(value) => {
                setQuery(value)
                setCurrent(0)
              }}
              current={current}
              total={total}
              onStep={step}
              onClose={() => {
                setFindOpen(false)
                setQuery('')
              }}
            />
          ) : null}
          {route.params.notice ? (
            <View style={[styles.notice, { backgroundColor: 'rgba(255,159,63,0.14)', borderBottomColor: theme.separator }]}>
              <SymbolView name="exclamationmark.triangle" size={16} tintColor={theme.orange} />
              <Text style={[styles.noticeText, { color: theme.text }]}>{route.params.notice}</Text>
            </View>
          ) : null}
          <View style={[styles.toolbar, { borderBottomColor: theme.separator }]}>
            {table ? (
              <View style={styles.segmented}>
                <Segmented options={[{ value: 'table', label: 'Table' }, { value: 'text', label: 'Text' }]} value={mode} onChange={(value) => { setMode(value); setCurrent(0) }} />
              </View>
            ) : null}
            {formatted !== null ? <ToolbarToggle label="Formatted" selected={showFormatted} onPress={() => { setShowFormatted((value) => !value); setCurrent(0) }} /> : null}
            <Text numberOfLines={1} style={[styles.status, { color: theme.secondary }]}>{status}</Text>
            {!showGrid ? <ToolbarToggle label="Wrap" selected={wrap} onPress={() => setWrap((value) => !value)} /> : null}
            {Platform.OS === 'ios'
              ? <GlassIconButton icon="doc.on.doc" label="Copy" onPress={() => { void Clipboard.setStringAsync(shown) }} />
              : <MaterialIconButton icon="doc.on.doc" label="Copy" onPress={() => { void Clipboard.setStringAsync(shown) }} />}
          </View>
          {showGrid && table ? (
            <GridView ref={gridRef} table={table} matchRows={matchRowSet} currentRow={rowMatches[current]} bottomInset={insets.bottom} />
          ) : lines ? (
            <CodeView ref={codeRef} lines={lines.lines} plain={lines.plain} wrap={wrap} matches={lineMatches} current={current} bottomInset={insets.bottom} />
          ) : null}
        </>
      ) : content.isError || nodeQuery.isError ? (
        <View style={styles.center}>
          <SymbolView name="exclamationmark.triangle" size={36} tintColor={theme.tertiary} />
          <Text style={[styles.centerText, { color: theme.secondary }]}>{filesErrorMessage(content.error ?? nodeQuery.error)}</Text>
        </View>
      ) : <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centerText: { fontSize: 15, textAlign: 'center' },
  headerButtons: { flexDirection: 'row' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  segmented: { width: 160 },
  status: { flex: 1, fontSize: 13 },
  chip: { borderRadius: 14, paddingHorizontal: 12, height: 28, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '500' },
  findBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  findField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 10, height: 36 },
  findInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  findCount: { fontSize: 13, fontVariant: ['tabular-nums'] },
  findButton: { padding: 4 },
  findDone: { fontSize: 16, fontWeight: '600', paddingLeft: 4 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 19 },
})
