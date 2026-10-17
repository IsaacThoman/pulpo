import type { FileConversionPreview } from '@pulpo/contracts'
import { diffRows, lineDiff } from '@pulpo/client-core/files'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { SafeMarkdown } from '../../../components/SafeMarkdown'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { PageHeader } from '../../../mockup5/src/components/PrototypeUI'
import { MaterialButton } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { convertToDoc, downloadFile, fetchConversionPreview } from '../api'
import { useFilesEnabled } from '../availability'
import { forgetStaleDocCopies } from '../cache'
import { FilesTurnedOff } from '../components/FilesTurnedOff'
import { filesErrorMessage } from '../display'
import { shareFileItem } from '../open'
import { refreshFiles } from '../operations'
import { fileNodeQuery, filesQueryKeys } from '../queries'
import { useFilesNamespace } from '../useFilesNamespace'

type Props = NativeStackScreenProps<RootStackParamList, 'FileMarkdown'>

/** What converting changes, line by line, before the user agrees to it. */
function ConversionSheet({ preview, converting, onConfirm, onCancel }: {
  preview: FileConversionPreview
  converting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const theme = useAppTheme()
  const rows = useMemo(() => {
    const diff = lineDiff(preview.original, preview.converted)
    return diff ? diffRows(diff) : null
  }, [preview])
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: theme.separator }]}>
          <Pressable accessibilityRole="button" onPress={onCancel} style={styles.sheetSide}><Text style={[styles.sheetButton, { color: theme.blue }]}>Cancel</Text></Pressable>
          <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.text }]}>Make Editable</Text>
          <Pressable accessibilityRole="button" disabled={converting} onPress={onConfirm} style={[styles.sheetSide, styles.sheetTrailing]} testID="conversion-confirm">
            {converting ? <ActivityIndicator color={theme.blue} /> : <Text style={[styles.sheetButton, styles.sheetConfirm, { color: theme.blue }]}>Convert</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={[styles.sheetIntro, { color: theme.secondary }]}>
            Editing turns this file into a document. Some of its Markdown will be written differently:
          </Text>
          {rows ? rows.map((row, index) => row.kind === 'gap' ? (
            <Text key={index} style={[styles.gap, { color: theme.tertiary }]}>{row.count} unchanged {row.count === 1 ? 'line' : 'lines'}</Text>
          ) : (
            <Text
              key={index}
              style={[styles.diffLine, {
                color: row.kind === 'same' ? theme.secondary : theme.text,
                backgroundColor: row.kind === 'added' ? 'rgba(52,199,89,0.16)' : row.kind === 'removed' ? 'rgba(255,59,48,0.14)' : 'transparent',
              }]}
            >
              {row.kind === 'added' ? '+ ' : row.kind === 'removed' ? '− ' : '  '}{row.text || ' '}
            </Text>
          )) : <Text style={[styles.sheetIntro, { color: theme.secondary }]}>The file is too large to compare line by line.</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

/** An uploaded Markdown file: shown read only, as uploaded, until the user chooses Edit. */
export function FileMarkdownScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const nodeQuery = useQuery({ ...fileNodeQuery(namespace, route.params.fileId), enabled: Boolean(namespace) && filesEnabled })
  const node = nodeQuery.data?.node
  const content = useQuery({
    queryKey: [...filesQueryKeys.node(namespace, route.params.fileId), 'content', node?.updatedAt ?? ''],
    queryFn: async () => (await downloadFile(node!)).text(),
    enabled: Boolean(node) && node?.kind === 'blob' && filesEnabled,
  })
  const [preview, setPreview] = useState<FileConversionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  // Made a document meanwhile (here, or on another device): it opens in the editor instead, once.
  const leaving = useRef(false)
  useEffect(() => {
    if (node?.kind !== 'doc' || leaving.current) return
    leaving.current = true
    navigation.replace('FileDocument', { fileId: node.id, name: node.name })
  }, [navigation, node])

  const convert = async () => {
    if (!node) return
    setBusy(true)
    // Set before the request: the server announces the change before it answers, and the refetch
    // that follows would otherwise open the editor as well.
    leaving.current = true
    try {
      // A copy left from when this was a document before must not be merged into the new one.
      await forgetStaleDocCopies(namespace, [node]).catch(() => undefined)
      const doc = await convertToDoc(node.id)
      setPreview(null)
      await refreshFiles(queryClient, namespace)
      navigation.replace('FileDocument', { fileId: doc.id, name: doc.name })
    } catch (error) {
      leaving.current = false
      Alert.alert('Couldn’t make this file editable', filesErrorMessage(error, node.name))
    } finally {
      setBusy(false)
    }
  }
  const edit = async () => {
    if (!node || busy) return
    setBusy(true)
    try {
      const dryRun = await fetchConversionPreview(node.id)
      if (dryRun.changed) setPreview(dryRun)
      else {
        setBusy(false)
        await convert()
        return
      }
    } catch (error) {
      Alert.alert('Couldn’t make this file editable', filesErrorMessage(error, node.name))
    }
    setBusy(false)
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: node?.name ?? route.params.name ?? 'Markdown',
      headerShown: Platform.OS === 'ios',
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' && node && filesEnabled ? () => [
        { type: 'button', label: 'Share', icon: { type: 'sfSymbol', name: 'square.and.arrow.up' }, onPress: () => { void shareFileItem(node).catch((error) => Alert.alert('Couldn’t share', filesErrorMessage(error))) } },
        { type: 'button', label: busy ? 'Opening…' : 'Edit', variant: 'prominent', disabled: busy || Boolean(node.trashedAt), onPress: () => { void edit() } },
      ] : undefined,
    })
  })

  return (
    <View style={[styles.flex, { backgroundColor: theme.isDark ? theme.background : theme.elevated, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
      {Platform.OS === 'android' ? (
        <PageHeader title={node?.name ?? 'Markdown'} onBack={() => navigation.goBack()} right={node && filesEnabled ? <MaterialButton label="Edit" onPress={() => { void edit() }} /> : null} />
      ) : null}
      {!filesEnabled ? <FilesTurnedOff /> : content.data !== undefined ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <SafeMarkdown>{content.data}</SafeMarkdown>
        </ScrollView>
      ) : content.isError || nodeQuery.isError ? (
        <View style={styles.center}>
          <SymbolView name="exclamationmark.triangle" size={36} tintColor={theme.tertiary} />
          <Text style={[styles.centerText, { color: theme.secondary }]}>{filesErrorMessage(content.error ?? nodeQuery.error)}</Text>
        </View>
      ) : <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>}
      {preview ? <ConversionSheet preview={preview} converting={busy} onConfirm={() => { void convert() }} onCancel={() => setPreview(null)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centerText: { fontSize: 15, textAlign: 'center' },
  sheetHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetSide: { width: 90 },
  sheetTrailing: { alignItems: 'flex-end' },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  sheetButton: { fontSize: 17 },
  sheetConfirm: { fontWeight: '600' },
  sheetContent: { padding: 16, gap: 1 },
  sheetIntro: { fontSize: 15, lineHeight: 21, marginBottom: 12 },
  gap: { fontSize: 12, paddingVertical: 6, textAlign: 'center' },
  diffLine: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12.5, lineHeight: 18, paddingHorizontal: 6 },
})
