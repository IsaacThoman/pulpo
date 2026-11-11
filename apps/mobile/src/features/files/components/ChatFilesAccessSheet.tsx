import { FILE_SCOPE_ROOT, fileReferenceHref, type FileNode } from '@pulpo/contracts'
import { useQueries } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import type { ChatFilesAccess } from '../chatScope'
import { fileIcon, fileSubtitle } from '../display'
import { fileNodeQuery } from '../queries'

interface Props {
  namespace: string
  access: ChatFilesAccess
  onClose: () => void
  /** Opens an item's page (the sheet closes first). */
  onOpen: (href: string) => void
}

/**
 * What the agent can use from Files in a chat: the items its messages mentioned, and whether it may
 * look through the rest. Each can be taken back here.
 */
export function ChatFilesAccessSheet({ namespace, access, onClose, onOpen }: Props) {
  const theme = useAppTheme()
  const ids = access.itemIds.filter((id) => id !== FILE_SCOPE_ROOT)
  const nodes = useQueries({ queries: ids.map((id) => ({ ...fileNodeQuery(namespace, id), staleTime: 30_000, retry: false })) })
  const byId = new Map<string, { node?: FileNode; missing: boolean }>()
  ids.forEach((id, index) => {
    const query = nodes[index]
    const node = query?.data?.node
    byId.set(id, { node, missing: Boolean(query?.isError) || Boolean(node?.trashedAt) })
  })
  const empty = !access.itemIds.length && !access.browseAllowed
  const remove = (id: string) => {
    Haptics.selectionAsync()
    access.removeItem(id)
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView onAccessibilityEscape={onClose} edges={['bottom']} style={[styles.flex, { backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <View style={styles.headerSide} />
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>Files Access</Text>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onClose} style={[styles.headerSide, styles.headerTrailing]}>
            <Text style={[styles.headerButton, styles.headerDone, { color: theme.blue }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.intro, { color: theme.secondary }]}>
            The agent can use the items you mention in this chat. Mention more from Add from Files in the + menu.
          </Text>
          {empty ? (
            <Text style={[styles.empty, { color: theme.secondary }]}>Nothing from your Files yet.</Text>
          ) : (
            <View style={[styles.card, { backgroundColor: theme.isDark ? theme.elevated2 : theme.elevated, borderColor: theme.separator }]}>
              {access.browseAllowed ? (
                <Row
                  symbol="doc.text.magnifyingglass"
                  tint={theme.blue}
                  title="Can look through all of your Files"
                  detail="You allowed this in this chat."
                  action="Revoke"
                  onAction={() => { Haptics.selectionAsync(); access.revokeBrowse() }}
                  last={!access.itemIds.length}
                />
              ) : null}
              {access.itemIds.map((id, index) => {
                const last = index === access.itemIds.length - 1
                if (id === FILE_SCOPE_ROOT) {
                  return <Row key={id} symbol="folder.fill" tint={theme.blue} title="All of My files" action="Remove" onAction={() => remove(id)} last={last} />
                }
                const entry = byId.get(id)
                const node = entry?.node
                const icon = node ? fileIcon(node) : { symbol: 'doc', tint: theme.secondary }
                return (
                  <Row
                    key={id}
                    symbol={icon.symbol}
                    tint={entry?.missing ? theme.tertiary : icon.tint}
                    title={node?.name ?? (entry?.missing ? 'Unavailable item' : 'Loading…')}
                    detail={entry?.missing ? 'No longer available' : node ? fileSubtitle(node) : undefined}
                    onOpen={node && !entry?.missing ? () => onOpen(fileReferenceHref({ id, folder: node.kind === 'folder' })) : undefined}
                    action="Remove"
                    onAction={() => remove(id)}
                    last={last}
                  />
                )
              })}
            </View>
          )}
          {!access.askBeforeBrowsing ? (
            <Text style={[styles.footnote, { color: theme.secondary }]}>Your settings let the agent look through your Files without asking.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function Row({ symbol, tint, title, detail, onOpen, action, onAction, last }: {
  symbol: string
  tint: string
  title: string
  detail?: string
  onOpen?: () => void
  action: string
  onAction: () => void
  last: boolean
}) {
  const theme = useAppTheme()
  return (
    <View style={[styles.row, !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Pressable
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={onOpen ? `Open ${title}` : undefined}
        disabled={!onOpen}
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
      >
        <SymbolView name={symbol as never} size={22} tintColor={tint} style={styles.rowIcon} />
        <View style={styles.flex}>
          <Text numberOfLines={2} style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
          {detail ? <Text numberOfLines={1} style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text> : null}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${action} ${title}`} hitSlop={8} onPress={onAction} style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}>
        <Text style={[styles.rowActionText, { color: theme.red }]}>{action}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 80 },
  headerTrailing: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 17 },
  headerDone: { fontWeight: '600' },
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 15, lineHeight: 20 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 15 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  rowIcon: { width: 28, height: 28 },
  rowTitle: { fontSize: 16 },
  rowDetail: { fontSize: 13, marginTop: 1 },
  rowAction: { paddingHorizontal: 14, paddingVertical: 12 },
  rowActionText: { fontSize: 15 },
  pressed: { opacity: 0.6 },
  footnote: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
})
