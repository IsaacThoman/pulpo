import type { FileNode } from '@pulpo/contracts'
import { DEFAULT_FILE_SORT, sortFileNodes } from '@pulpo/client-core/files'
import { useQuery } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { promptText } from '../../../platform/materialActions'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { fileIcon, filesErrorMessage, fileSubtitle } from '../display'
import { useFileOperations } from '../operations'
import { folderQuery } from '../queries'

interface Crumb {
  id: string | null
  name: string
}

interface BaseProps {
  namespace: string
  title: string
  /** Where browsing starts; the path above it is loaded so Back walks up from there. */
  initialFolderId?: string | null
  onCancel: () => void
}

type Props = BaseProps & (
  | {
    mode: 'destination'
    confirmLabel: string
    /** Items being moved: they and their contents cannot be the destination. */
    excludeIds?: readonly string[]
    onConfirm: (folderId: string | null, folderName: string) => void
  }
  | {
    mode: 'items'
    confirmLabel: string
    /** How many items may be picked in all. */
    limit: number
    /** Already attached; shown as picked and not counted again. */
    pickedIds?: readonly string[]
    onConfirm: (items: Array<{ id: string; name: string; kind: FileNode['kind'] }>, folder: Crumb) => void
  }
)

const ROOT: Crumb = { id: null, name: 'My files' }

/**
 * A sheet for choosing a folder (to move or save into) or Files items (for a chat's agent), with
 * its own path: folders open in place, and the header goes back up.
 */
export function FolderPickerSheet(props: Props) {
  const theme = useAppTheme()
  const operations = useFileOperations(props.namespace)
  const [path, setPath] = useState<Crumb[]>([ROOT])
  const [picked, setPicked] = useState<Map<string, { id: string; name: string; kind: FileNode['kind'] }>>(() => new Map())
  const current = path[path.length - 1]!
  const listing = useQuery({ ...folderQuery(props.namespace, current.id), staleTime: 10_000 })
  const excluded = new Set(props.mode === 'destination' ? props.excludeIds ?? [] : [])
  const alreadyPicked = new Set(props.mode === 'items' ? props.pickedIds ?? [] : [])

  // Start inside the initial folder once its path is known.
  const initial = useQuery({ ...folderQuery(props.namespace, props.initialFolderId ?? null), enabled: Boolean(props.initialFolderId) })
  const [startedInside, setStartedInside] = useState(false)
  if (!startedInside && props.initialFolderId && initial.data?.folder) {
    setStartedInside(true)
    setPath([ROOT, ...initial.data.ancestors.map((node) => ({ id: node.id, name: node.name })), { id: initial.data.folder.id, name: initial.data.folder.name }])
  }

  const items = useMemo(() => {
    const children = listing.data?.children ?? []
    const visible = children.filter((node) => (
      node.status === 'ready' && node.kind !== 'chat' && (props.mode === 'items' ? node.kind !== 'shortcut' || node.target?.kind === 'folder' : node.kind === 'folder' || node.target?.kind === 'folder')
    ))
    return sortFileNodes(visible, DEFAULT_FILE_SORT)
  }, [listing.data?.children, props.mode])

  const open = (node: FileNode) => {
    const id = node.kind === 'shortcut' ? node.target?.id ?? null : node.id
    if (!id || excluded.has(id)) return
    Haptics.selectionAsync()
    setPath((current) => [...current, { id, name: node.kind === 'shortcut' ? node.target?.name ?? node.name : node.name }])
  }
  const togglePick = (node: FileNode) => {
    if (props.mode !== 'items' || alreadyPicked.has(node.id)) return
    Haptics.selectionAsync()
    setPicked((current) => {
      const next = new Map(current)
      if (next.has(node.id)) next.delete(node.id)
      else if (next.size + alreadyPicked.size < props.limit) next.set(node.id, { id: node.id, name: node.name, kind: node.kind })
      else Alert.alert('That’s the limit', `A chat can work with up to ${props.limit} items.`)
      return next
    })
  }
  const newFolder = () => {
    const create = async (name: string) => {
      const folder = await operations.createFolder(current.id, name)
      if (folder) setPath((existing) => [...existing, { id: folder.id, name: folder.name }])
    }
    if (Platform.OS === 'ios') Alert.prompt('New Folder', undefined, (name) => { if (name.trim()) void create(name) }, 'plain-text', 'Untitled folder')
    else promptText({ title: 'New folder', value: 'Untitled folder', confirmLabel: 'Create', onSubmit: (name) => { void create(name) } })
  }
  const confirm = () => {
    if (props.mode === 'destination') props.onConfirm(current.id, current.name)
    else props.onConfirm([...picked.values()], current)
  }
  const destinationBlocked = props.mode === 'destination' && current.id !== null && excluded.has(current.id)
  const confirmLabel = props.mode === 'items' && picked.size === 0
    ? (current.id === null ? 'Add All Files' : 'Add This Folder')
    : props.confirmLabel

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onCancel}>
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={props.onCancel} style={styles.headerSide}>
            <Text style={[styles.headerButton, { color: theme.blue }]}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>{props.title}</Text>
          <Pressable accessibilityRole="button" disabled={destinationBlocked} hitSlop={10} onPress={confirm} style={[styles.headerSide, styles.headerTrailing]} testID="folder-picker-confirm">
            <Text numberOfLines={1} style={[styles.headerButton, styles.headerConfirm, { color: destinationBlocked ? theme.tertiary : theme.blue }]}>{confirmLabel}</Text>
          </Pressable>
        </View>
        <View style={styles.pathBar}>
          {path.length > 1 ? (
            <Pressable accessibilityLabel={`Back to ${path[path.length - 2]!.name}`} accessibilityRole="button" hitSlop={8} onPress={() => setPath((existing) => existing.slice(0, -1))} style={styles.back}>
              <SymbolView name="chevron.left" size={15} tintColor={theme.blue} />
              <Text numberOfLines={1} style={[styles.backLabel, { color: theme.blue }]}>{path[path.length - 2]!.name}</Text>
            </Pressable>
          ) : null}
          <Text numberOfLines={1} style={[styles.folderName, { color: theme.text }]}>{current.name}</Text>
          {props.mode === 'items' && picked.size ? <Text style={[styles.pickedCount, { color: theme.secondary }]}>{picked.size} selected</Text> : null}
        </View>
        {listing.isPending ? <ActivityIndicator style={styles.loading} color={theme.secondary} /> : listing.isError ? (
          <Text style={[styles.empty, { color: theme.secondary }]}>{filesErrorMessage(listing.error)}</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(node) => node.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={[styles.empty, { color: theme.secondary }]}>{props.mode === 'destination' ? 'No folders here' : 'This folder is empty'}</Text>}
            renderItem={({ item }) => {
              const folder = item.kind === 'folder' || item.target?.kind === 'folder'
              const blocked = excluded.has(item.id)
              const isPicked = picked.has(item.id) || alreadyPicked.has(item.id)
              const icon = fileIcon(item)
              return (
                <View style={[styles.row, { borderBottomColor: theme.separator, opacity: blocked ? 0.4 : 1 }]}>
                  {props.mode === 'items' ? (
                    <Pressable accessibilityLabel={`${isPicked ? 'Deselect' : 'Select'} ${item.name}`} accessibilityRole="checkbox" accessibilityState={{ checked: isPicked, disabled: alreadyPicked.has(item.id) }} hitSlop={6} onPress={() => togglePick(item)} style={styles.pick}>
                      <SymbolView name={isPicked ? 'checkmark.circle.fill' : 'circle'} size={22} tintColor={isPicked ? (alreadyPicked.has(item.id) ? theme.tertiary : theme.blue) : theme.tertiary} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={folder ? `Open ${item.name}` : item.name}
                    disabled={blocked || (!folder && props.mode === 'destination')}
                    onPress={() => folder ? open(item) : togglePick(item)}
                    style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
                  >
                    <SymbolView name={icon.symbol as never} size={24} tintColor={icon.tint} style={styles.rowIcon} />
                    <View style={styles.flex}>
                      <Text numberOfLines={1} style={[styles.rowName, { color: theme.text }]}>{item.kind === 'shortcut' ? item.target?.name ?? item.name : item.name}</Text>
                      <Text numberOfLines={1} style={[styles.rowSubtitle, { color: theme.secondary }]}>{fileSubtitle(item)}</Text>
                    </View>
                    {folder ? <SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} /> : null}
                  </Pressable>
                </View>
              )
            }}
          />
        )}
        {props.mode === 'destination' ? (
          <View style={[styles.footer, { borderTopColor: theme.separator }]}>
            <Pressable accessibilityRole="button" onPress={newFolder} style={({ pressed }) => [styles.footerButton, pressed && { opacity: 0.6 }]}>
              <SymbolView name="folder.badge.plus" size={20} tintColor={theme.blue} />
              <Text style={[styles.footerLabel, { color: theme.blue }]}>New Folder</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 112 },
  headerTrailing: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 17 },
  headerConfirm: { fontWeight: '600' },
  pathBar: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, gap: 4 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backLabel: { fontSize: 15, maxWidth: 240 },
  folderName: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  pickedCount: { fontSize: 13 },
  loading: { marginTop: 40 },
  list: { paddingBottom: 24 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15, paddingHorizontal: 24 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, marginLeft: 16 },
  pick: { paddingRight: 10, paddingVertical: 12 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingRight: 16 },
  rowIcon: { width: 30, height: 30 },
  rowName: { fontSize: 17 },
  rowSubtitle: { fontSize: 13, marginTop: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10 },
  footerButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  footerLabel: { fontSize: 17 },
})
