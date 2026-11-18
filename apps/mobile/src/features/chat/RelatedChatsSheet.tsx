import type { RelatedChat, RelatedChats } from '@pulpo/contracts'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SymbolView } from '../../platform/SymbolView'
import { useAppTheme, type AppTheme } from '../../theme'
import { relatedChatSections } from './threads'

interface Props {
  related: RelatedChats | undefined
  loading: boolean
  error: boolean
  onClose: () => void
  /** Opens a thread or side chat (the sheet closes first). */
  onOpen: (chat: RelatedChat) => void
  onRetry: () => void
}

function statusSymbol(chat: RelatedChat, theme: AppTheme): { symbol: string; tint: string } {
  if (chat.kind === 'side') return { symbol: 'bubble.left.and.bubble.right', tint: theme.secondary }
  switch (chat.status) {
    case 'attention': return { symbol: 'exclamationmark.triangle', tint: theme.orange }
    case 'done': return { symbol: 'checkmark.circle', tint: theme.green }
    case 'resolved': return { symbol: 'checkmark.circle.fill', tint: theme.tertiary }
    default: return { symbol: 'arrow.triangle.branch', tint: theme.blue }
  }
}

/** A chat's threads, by where each stands, and its side chats. Tapping one opens it. */
export function RelatedChatsSheet({ related, loading, error, onClose, onOpen, onRetry }: Props) {
  const theme = useAppTheme()
  const sections = related ? relatedChatSections(related) : []
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView onAccessibilityEscape={onClose} edges={['bottom']} style={[styles.flex, { backgroundColor: theme.isDark ? theme.elevated : theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <View style={styles.headerSide} />
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>Threads</Text>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onClose} style={[styles.headerSide, styles.headerTrailing]}>
            <Text style={[styles.headerButton, { color: theme.blue }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {!related && loading ? <ActivityIndicator color={theme.secondary} style={styles.empty} /> : null}
          {!related && error ? (
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.secondary }]}>Couldn’t load this chat’s threads.</Text>
              <Text style={[styles.emptyText, { color: theme.blue }]}>Try again</Text>
            </Pressable>
          ) : null}
          {related && !sections.length ? (
            <Text style={[styles.emptyText, styles.empty, { color: theme.secondary }]}>No threads or side chats yet.</Text>
          ) : null}
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.secondary }]}>{section.title.toUpperCase()}</Text>
              <View style={[styles.card, { backgroundColor: theme.isDark ? theme.elevated2 : theme.elevated, borderColor: theme.separator }]}>
                {section.data.map((chat, index) => {
                  const icon = statusSymbol(chat, theme)
                  const last = index === section.data.length - 1
                  return (
                    <Pressable
                      key={chat.id}
                      accessibilityRole="button"
                      accessibilityLabel={[chat.title, chat.kind === 'thread' ? section.title : null, chat.summary].filter(Boolean).join(', ')}
                      accessibilityHint={chat.kind === 'thread' ? 'Opens the thread' : 'Opens the side chat'}
                      onPress={() => onOpen(chat)}
                      style={({ pressed }) => [styles.row, !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }, pressed && styles.pressed]}
                    >
                      <SymbolView name={icon.symbol as never} size={20} tintColor={icon.tint} style={styles.rowIcon} />
                      <View style={styles.flex}>
                        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text }]}>{chat.title}</Text>
                        {chat.summary ? <Text numberOfLines={2} style={[styles.rowDetail, { color: theme.secondary }]}>{chat.summary}</Text> : null}
                      </View>
                      <SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} />
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 80 },
  headerTrailing: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 17, fontWeight: '600' },
  content: { padding: 16, gap: 20 },
  empty: { marginTop: 24, alignItems: 'center', gap: 6 },
  emptyText: { textAlign: 'center', fontSize: 15 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 12.5, fontWeight: '600', letterSpacing: 0.3, paddingHorizontal: 4 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  rowIcon: { width: 24, height: 24 },
  rowTitle: { fontSize: 16 },
  rowDetail: { fontSize: 13, lineHeight: 17, marginTop: 2 },
  pressed: { opacity: 0.6 },
})
