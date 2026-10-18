import type { FileNode } from '@pulpo/contracts'
import { memo } from 'react'
import { Platform, Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native'
import { ItemContextMenuView, itemContextMenuAvailable, type ContextMenuAction } from '../../../native/ItemContextMenuView'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { fileIcon, fileKindLabel, fileSubtitle } from '../../files/display'

/** How far each level of a folder's contents is indented, as the web nests them. */
export const SIDEBAR_INDENT = 16

export interface SidebarRowStyles {
  /** The drawer's chat row styles, so these line up with the chats around them. */
  row: StyleProp<ViewStyle>
  active: StyleProp<ViewStyle>
  pressed: StyleProp<ViewStyle>
  title: StyleProp<TextStyle>
  count: StyleProp<TextStyle>
  /** The native menu's host, sized like a chat row. */
  menuHost: StyleProp<ViewStyle>
}

interface Props {
  node: FileNode
  depth: number
  styles: SidebarRowStyles
  actions: ContextMenuAction[]
  /** A row that opens a folder in place: its chevron, and how many chats are in it. */
  folder?: { expanded: boolean; chatCount: number }
  /** A shortcut to the open chat. */
  active?: boolean
  /** A shortcut to something in the trash, which cannot open. */
  unavailable?: boolean
  onPress: (node: FileNode) => void
  onAction: (node: FileNode, action: string) => void
  /** Android has no native menu view: long pressing shows the actions instead. */
  onLongPress: (node: FileNode, anchor: { x: number; y: number }) => void
}

/** A folder, file, or shortcut in the drawer, among the chats; a folder opens and closes in place. */
export const SidebarNodeRow = memo(function SidebarNodeRow({ node, depth, styles: rowStyles, actions, folder, active, unavailable, onPress, onAction, onLongPress }: Props) {
  const theme = useAppTheme()
  // Muted unless given a color, as the web sidebar shows them among the chats.
  const kindIcon = fileIcon(node)
  const icon = node.color ?? node.target?.color ? kindIcon : { ...kindIcon, tint: theme.secondary }
  const label = [
    node.name,
    folder ? `folder${folder.chatCount ? `, ${folder.chatCount} chat${folder.chatCount === 1 ? '' : 's'}` : ''}` : fileKindLabel(node),
    node.pinned ? 'pinned' : null,
    node.suggestion ? 'suggested by the agent' : null,
    unavailable ? 'in the trash' : null,
  ].filter(Boolean).join(', ')
  const hint = folder
    ? `Double tap to ${folder.expanded ? 'close' : 'open'}. Touch and hold for more actions.`
    : 'Double tap to open. Touch and hold for more actions.'
  const content = (
    <>
      {folder ? (
        <SymbolView name={folder.expanded ? 'chevron.down' : 'chevron.right'} size={11} tintColor={theme.tertiary} style={styles.chevron} />
      ) : null}
      <View>
        <SymbolView name={icon.symbol as never} size={16} tintColor={icon.tint} />
        {node.kind === 'shortcut' ? (
          <View style={[styles.shortcutBadge, { backgroundColor: theme.elevated }]}>
            <SymbolView name="arrow.turn.up.right" size={7} tintColor={theme.text} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[rowStyles.title, styles.name]}>{node.name}</Text>
      {node.suggestion ? (
        <View style={[styles.badge, { backgroundColor: theme.fillStrong }]}>
          <Text style={[styles.badgeText, { color: theme.green }]}>Suggested</Text>
        </View>
      ) : null}
      {folder?.chatCount ? <Text style={rowStyles.count}>{folder.chatCount}</Text> : null}
    </>
  )
  // The native menu host spans the list, so an indented one gives up its full width.
  const indent = depth ? { marginLeft: depth * SIDEBAR_INDENT, width: 'auto', alignSelf: 'stretch' } as const : null
  const dimmed = unavailable ? styles.dimmed : null
  if (Platform.OS === 'ios' && itemContextMenuAvailable) {
    return (
      <ItemContextMenuView
        accessible
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityHint={hint}
        accessibilityState={{ expanded: folder?.expanded, selected: active }}
        actions={actions}
        preview={{ title: node.name, subtitle: fileSubtitle(node), systemImage: icon.symbol, tint: icon.tint }}
        onAction={(action) => onAction(node, action)}
        onPress={() => onPress(node)}
        style={[rowStyles.menuHost, indent]}
        testID={`sidebar-item-${node.name}`}
      >
        <View pointerEvents="none" style={[rowStyles.row, active && rowStyles.active, dimmed]}>{content}</View>
      </ItemContextMenuView>
    )
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ expanded: folder?.expanded, selected: active }}
      delayLongPress={350}
      onLongPress={(event) => onLongPress(node, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
      onPress={() => onPress(node)}
      style={({ pressed }) => [rowStyles.row, indent, active && rowStyles.active, pressed && rowStyles.pressed, dimmed]}
      testID={`sidebar-item-${node.name}`}
    >
      {content}
    </Pressable>
  )
})

/** "Empty" (or loading) inside an open folder, or the drawer's own empty state. */
export function SidebarMessageRow({ label, depth, style }: { label: string; depth: number; style: StyleProp<TextStyle> }) {
  return <Text style={[style, { marginLeft: depth * SIDEBAR_INDENT }]}>{label}</Text>
}

const styles = StyleSheet.create({
  chevron: { width: 12, marginRight: -4 },
  name: { flex: 1 },
  shortcutBadge: { position: 'absolute', right: -4, bottom: -3, width: 11, height: 11, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  dimmed: { opacity: 0.6 },
})
