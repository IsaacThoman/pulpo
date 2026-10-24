import type { FileNode } from '@pulpo/contracts'
import { memo } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ItemContextMenuView, itemContextMenuAvailable, type ContextMenuAction } from '../../../native/ItemContextMenuView'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { fileIcon, fileSubtitle, openedKind } from '../display'

export const FILE_ROW_HEIGHT = 64

interface Props {
  node: FileNode
  actions: ContextMenuAction[]
  /** Selection mode: tapping toggles; the menu stays available. */
  selecting?: boolean
  selected?: boolean
  busy?: boolean
  last?: boolean
  /** In place of the item's usual details (the trash shows each item's deadline). */
  subtitle?: string
  /** Whether tapping opens a folder, marked with a chevron; by default, whether the item is one. */
  opensFolder?: boolean
  onPress: (node: FileNode) => void
  onAction: (node: FileNode, action: string) => void
  /** Android has no native menu view: long pressing shows the actions instead. */
  onLongPress?: (node: FileNode) => void
}

/** One item in a Files list: its icon, name, details, and marks for pinned and suggested items. */
export const FileRow = memo(function FileRow({ node, actions, selecting, selected, busy, last, subtitle = fileSubtitle(node), opensFolder, onPress, onAction, onLongPress }: Props) {
  const theme = useAppTheme()
  const icon = fileIcon(node)
  const folder = opensFolder ?? openedKind(node) === 'folder'
  const label = `${node.name}, ${subtitle}${node.suggestion ? ', suggested by the agent' : ''}${node.pinned ? ', pinned' : ''}`
  const content = (
    <View style={[styles.row, { minHeight: FILE_ROW_HEIGHT }]}>
      {selecting ? (
        <SymbolView
          name={selected ? 'checkmark.circle.fill' : 'circle'}
          size={22}
          tintColor={selected ? theme.blue : theme.tertiary}
          style={styles.check}
        />
      ) : null}
      <View style={styles.icon}>
        <SymbolView name={icon.symbol as never} size={28} tintColor={icon.tint} />
        {node.kind === 'shortcut' ? (
          <View style={[styles.shortcutBadge, { backgroundColor: theme.elevated }]}>
            <SymbolView name="arrow.turn.up.right" size={9} tintColor={theme.text} />
          </View>
        ) : null}
      </View>
      <View style={[styles.text, !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{node.name}</Text>
          {node.pinned ? <SymbolView name="pin.fill" size={11} tintColor={theme.orange} /> : null}
          {node.suggestion ? (
            <View style={[styles.badge, { backgroundColor: theme.fillStrong }]}>
              <Text style={[styles.badgeText, { color: theme.green }]}>Suggested</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.subtitle, { color: theme.secondary }]}>{subtitle}</Text>
        <View style={styles.trailing}>
          {busy || node.status === 'pending' ? <ActivityIndicator size="small" color={theme.secondary} /> : folder && !selecting ? <SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} /> : null}
        </View>
      </View>
    </View>
  )
  if (Platform.OS === 'ios' && itemContextMenuAvailable) {
    return (
      <ItemContextMenuView
        accessible
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: selecting ? selected : undefined }}
        accessibilityHint={selecting ? 'Double tap to select.' : 'Double tap to open. Touch and hold for more actions.'}
        actions={actions}
        preview={{ title: node.name, subtitle, systemImage: icon.symbol, tint: icon.tint }}
        onAction={(action) => onAction(node, action)}
        onPress={() => onPress(node)}
        testID={`file-row-${node.name}`}
      >
        <View pointerEvents="none">{content}</View>
      </ItemContextMenuView>
    )
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: selecting ? selected : undefined }}
      delayLongPress={350}
      onLongPress={() => onLongPress?.(node)}
      onPress={() => onPress(node)}
      android_ripple={{ color: theme.fill }}
      style={({ pressed }) => [pressed && Platform.OS !== 'android' && { opacity: 0.6 }]}
      testID={`file-row-${node.name}`}
    >
      {content}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16 },
  check: { width: 26, height: 26, marginRight: 10 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  shortcutBadge: { position: 'absolute', right: -2, bottom: -2, width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', paddingRight: 44, paddingVertical: 10 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 17, lineHeight: 22 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 1 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  trailing: { position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' },
})
