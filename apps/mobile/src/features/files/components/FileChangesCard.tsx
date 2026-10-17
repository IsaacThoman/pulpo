import type { FileChangeConflict, FileChangesResponse, FileChangeSummary } from '@pulpo/contracts'
import { diffRows, fileChangeConflictsOf, lineDiff, pendingSuggestion } from '@pulpo/client-core/files'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ApiError } from '../../../api/client'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { fetchFileNode, resolveFileChange, updateFileChanges } from '../api'
import { changeLabel, conflictReason } from '../changeLabels'
import { fileIcon, filesErrorMessage } from '../display'
import { previewUploadedFile } from '../open'
import { refreshFiles } from '../operations'
import { fileChangesQuery, filesQueryKeys } from '../queries'

const COLLAPSED_ROWS = 4

function statusLabel(change: FileChangeSummary): string | null {
  if (!change.available) return 'no longer available'
  switch (change.status) {
    case 'pending': return change.nodeKind === 'doc' && change.kind === 'update' ? 'review in the document' : 'suggested'
    case 'accepted': return 'kept'
    case 'rejected': return 'rejected'
    case 'undone': return 'undone'
    case 'applied': return null
  }
}

function ConflictSheet({ action, conflicts, onClose }: { action: 'undo' | 'redo'; conflicts: FileChangeConflict[]; onClose: () => void }) {
  const theme = useAppTheme()
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: theme.separator }]}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.text }]}>{action === 'undo' ? 'Can’t Undo' : 'Can’t Redo'}</Text>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onClose} style={styles.sheetDone}><Text style={[styles.sheetDoneLabel, { color: theme.blue }]}>Done</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={[styles.sheetIntro, { color: theme.secondary }]}>
            {action === 'undo' ? 'Nothing was undone, because these items changed after the agent’s reply:' : 'Nothing was redone, because these items changed since:'}
          </Text>
          {conflicts.map((conflict) => {
            const rows = conflict.expected !== undefined && conflict.current !== undefined ? lineDiff(conflict.expected, conflict.current) : null
            return (
              <View key={conflict.changeId} style={[styles.conflict, { borderColor: theme.separator }]}>
                <Text style={[styles.conflictName, { color: theme.text }]}>{conflict.name}</Text>
                <Text style={[styles.conflictReason, { color: theme.secondary }]}>{conflictReason(conflict)}</Text>
                {rows ? diffRows(rows).map((row, index) => row.kind === 'gap' ? (
                  <Text key={index} style={[styles.gap, { color: theme.tertiary }]}>{row.count} unchanged {row.count === 1 ? 'line' : 'lines'}</Text>
                ) : (
                  <Text key={index} style={[styles.diffLine, { color: row.kind === 'same' ? theme.secondary : theme.text, backgroundColor: row.kind === 'added' ? 'rgba(52,199,89,0.16)' : row.kind === 'removed' ? 'rgba(255,59,48,0.14)' : 'transparent' }]}>
                    {row.kind === 'added' ? '+ ' : row.kind === 'removed' ? '− ' : '  '}{row.text || ' '}
                  </Text>
                )) : null}
              </View>
            )
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

/**
 * What an agent reply changed in Files, under the reply: each item with what happened to it, the
 * suggestions to review, and undo and redo for changes made directly.
 */
export function FileChangesCard({ namespace, responseId }: { namespace: string; responseId: string }) {
  const theme = useAppTheme()
  const queryClient = useQueryClient()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const query = useQuery({ ...fileChangesQuery(namespace, responseId), enabled: Boolean(namespace) })
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<{ action: 'undo' | 'redo'; items: FileChangeConflict[] } | null>(null)
  const data = query.data
  const changes = useMemo(() => data?.changes ?? [], [data?.changes])
  const pending = changes.filter(pendingSuggestion)
  const visible = expanded ? changes : changes.slice(0, COLLAPSED_ROWS)

  const apply = async (key: string, request: () => Promise<FileChangesResponse>, action?: 'undo' | 'redo') => {
    if (busy) return
    setBusy(key)
    try {
      const next = await request()
      queryClient.setQueryData(filesQueryKeys.responseChanges(namespace, responseId), next)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (error) {
      const found = error instanceof ApiError ? fileChangeConflictsOf(error.code, error.body) : null
      if (found && action) setConflicts({ action, items: found })
      else Alert.alert('Couldn’t update the changes', filesErrorMessage(error))
    } finally {
      setBusy(null)
      await refreshFiles(queryClient, namespace)
    }
  }
  const open = async (change: FileChangeSummary) => {
    if (!change.available || change.kind === 'trash') return
    if (change.nodeKind === 'doc') navigation.push('FileDocument', { fileId: change.nodeId, name: change.name })
    else if (change.nodeKind === 'folder') navigation.push('FilesFolder', { folderId: change.nodeId, name: change.name })
    else {
      try {
        const { node } = await fetchFileNode(change.nodeId)
        await previewUploadedFile(node)
      } catch (error) {
        Alert.alert(`Couldn’t open “${change.name}”`, filesErrorMessage(error, change.name))
      }
    }
  }

  if (query.isPending) return <View style={[styles.card, { borderColor: theme.separator }]}><ActivityIndicator color={theme.secondary} /></View>
  if (!data || !changes.length) return null
  const summary = pending.length
    ? `${pending.length} ${pending.length === 1 ? 'suggestion' : 'suggestions'} to review`
    : `Changed ${changes.length} ${changes.length === 1 ? 'item' : 'items'} in Files`
  return (
    <View style={[styles.card, { borderColor: theme.separator, backgroundColor: theme.fill }]} testID="file-changes-card">
      <View style={styles.header}>
        <SymbolView name="folder.badge.gearshape" size={16} tintColor={theme.secondary} />
        <Text style={[styles.summary, { color: theme.text }]}>{summary}</Text>
        {busy === 'all' ? <ActivityIndicator size="small" color={theme.secondary} /> : null}
      </View>
      {visible.map((change) => {
        const icon = fileIcon({ kind: change.nodeKind, name: change.name, mimeType: change.mimeType })
        const status = statusLabel(change)
        const struck = change.status === 'rejected' || change.status === 'undone' || !change.available
        return (
          <View key={change.id} style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${change.name}, ${changeLabel(change)}${status ? `, ${status}` : ''}`} disabled={!change.available} onPress={() => { void open(change) }} style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}>
              <SymbolView name={icon.symbol as never} size={18} tintColor={icon.tint} />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.rowName, { color: theme.text, textDecorationLine: struck ? 'line-through' : 'none' }]}>{change.name}</Text>
                <Text numberOfLines={1} style={[styles.rowDetail, { color: theme.secondary }]}>{[changeLabel(change), status].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
            {pendingSuggestion(change) && !(change.nodeKind === 'doc' && change.kind === 'update') ? (
              <View style={styles.rowActions}>
                {busy === change.id ? <ActivityIndicator size="small" color={theme.secondary} /> : <>
                  <Pressable accessibilityLabel={`Reject ${change.name}`} accessibilityRole="button" hitSlop={6} onPress={() => { void apply(change.id, () => resolveFileChange(change.id, 'reject')) }} style={[styles.roundButton, { backgroundColor: theme.fillStrong }]}><SymbolView name="xmark" size={13} tintColor={theme.red} /></Pressable>
                  <Pressable accessibilityLabel={`Keep ${change.name}`} accessibilityRole="button" hitSlop={6} onPress={() => { void apply(change.id, () => resolveFileChange(change.id, 'accept')) }} style={[styles.roundButton, { backgroundColor: theme.fillStrong }]}><SymbolView name="checkmark" size={13} tintColor={theme.green} /></Pressable>
                </>}
              </View>
            ) : pendingSuggestion(change) ? (
              <Pressable accessibilityRole="button" onPress={() => { void open(change) }} style={[styles.reviewButton, { backgroundColor: theme.fillStrong }]}>
                <Text style={[styles.reviewLabel, { color: theme.blue }]}>Review</Text>
              </Pressable>
            ) : null}
          </View>
        )
      })}
      {changes.length > COLLAPSED_ROWS ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((current) => !current)} style={styles.more}>
          <Text style={[styles.moreLabel, { color: theme.blue }]}>{expanded ? 'Show fewer' : `Show all ${changes.length}`}</Text>
        </Pressable>
      ) : null}
      {(pending.length || data.canUndo || data.canRedo) ? (
        <View style={[styles.footer, { borderTopColor: theme.separator }]}>
          {pending.length ? <>
            <FooterButton label="Reject All" color={theme.red} disabled={Boolean(busy)} onPress={() => Alert.alert('Reject all suggestions?', 'Suggested items are deleted, and suggested edits are removed from their documents.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reject All', style: 'destructive', onPress: () => { void apply('all', () => updateFileChanges(responseId, 'reject')) } },
            ])} />
            <FooterButton label="Accept All" color={theme.green} disabled={Boolean(busy)} onPress={() => { void apply('all', () => updateFileChanges(responseId, 'accept')) }} />
          </> : null}
          {data.canUndo ? <FooterButton label="Undo Changes" color={theme.blue} disabled={Boolean(busy)} onPress={() => { void apply('all', () => updateFileChanges(responseId, 'undo'), 'undo') }} /> : null}
          {data.canRedo ? <FooterButton label="Redo Changes" color={theme.blue} disabled={Boolean(busy)} onPress={() => { void apply('all', () => updateFileChanges(responseId, 'redo'), 'redo') }} /> : null}
        </View>
      ) : null}
      {conflicts ? <ConflictSheet action={conflicts.action} conflicts={conflicts.items} onClose={() => setConflicts(null)} /> : null}
    </View>
  )
}

function FooterButton({ label, color, disabled, onPress }: { label: string; color: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.footerButton, (pressed || disabled) && { opacity: 0.5 }]} testID={`file-changes-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <Text style={[styles.footerLabel, { color }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginTop: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  summary: { flex: 1, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 48, gap: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowName: { fontSize: 15 },
  rowDetail: { fontSize: 12.5, marginTop: 1 },
  rowActions: { flexDirection: 'row', gap: 8 },
  roundButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  reviewButton: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  reviewLabel: { fontSize: 14, fontWeight: '600' },
  more: { paddingHorizontal: 14, paddingVertical: 8 },
  moreLabel: { fontSize: 14, fontWeight: '500' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingHorizontal: 6, paddingTop: 2 },
  footerButton: { paddingHorizontal: 8, paddingVertical: 10 },
  footerLabel: { fontSize: 15, fontWeight: '600' },
  sheetHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: '600' },
  sheetDone: { position: 'absolute', right: 16 },
  sheetDoneLabel: { fontSize: 17, fontWeight: '600' },
  sheetContent: { padding: 16, gap: 12 },
  sheetIntro: { fontSize: 15, lineHeight: 21 },
  conflict: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 4 },
  conflictName: { fontSize: 16, fontWeight: '600' },
  conflictReason: { fontSize: 14 },
  gap: { fontSize: 12, paddingVertical: 4, textAlign: 'center' },
  diffLine: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
})
