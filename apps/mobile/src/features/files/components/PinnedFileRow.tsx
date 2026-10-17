import type { FileNode } from '@pulpo/contracts'
import { memo } from 'react'
import { Platform, Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from 'react-native'
import { ItemContextMenuView, itemContextMenuAvailable, type ContextMenuAction } from '../../../native/ItemContextMenuView'
import { SymbolView } from '../../../platform/SymbolView'
import { fileIcon, fileSubtitle } from '../display'

const ACTIONS: ContextMenuAction[] = [
  { id: 'open', title: 'Open', systemImage: 'arrow.up.forward.app', section: 0 },
  { id: 'unpin', title: 'Unpin', systemImage: 'pin.slash', section: 1 },
]

interface Props {
  node: FileNode
  /** The drawer's chat row styles, so pinned items line up with the pinned chats. */
  rowStyle: StyleProp<ViewStyle>
  pressedStyle: StyleProp<ViewStyle>
  titleStyle: StyleProp<TextStyle>
  onOpen: (node: FileNode) => void
  onUnpin: (node: FileNode) => void
  /** Android has no native menu view: long pressing shows the actions instead. */
  onLongPress: (node: FileNode) => void
}

/** A pinned Files item in the drawer's Pinned list. */
export const PinnedFileRow = memo(function PinnedFileRow({ node, rowStyle, pressedStyle, titleStyle, onOpen, onUnpin, onLongPress }: Props) {
  const icon = fileIcon(node)
  const content = (
    <>
      <SymbolView name={icon.symbol as never} size={16} tintColor={icon.tint} />
      <Text numberOfLines={1} style={[titleStyle, { flex: 1 }]}>{node.name}</Text>
    </>
  )
  if (Platform.OS === 'ios' && itemContextMenuAvailable) {
    return (
      <ItemContextMenuView
        accessible
        accessibilityLabel={`${node.name}, pinned`}
        accessibilityRole="button"
        accessibilityHint="Double tap to open. Touch and hold for more actions."
        actions={ACTIONS}
        preview={{ title: node.name, subtitle: fileSubtitle(node), systemImage: icon.symbol, tint: icon.tint }}
        onAction={(action) => (action === 'unpin' ? onUnpin(node) : onOpen(node))}
        onPress={() => onOpen(node)}
        testID={`pinned-file-${node.name}`}
      >
        <View pointerEvents="none" style={rowStyle}>{content}</View>
      </ItemContextMenuView>
    )
  }
  return (
    <Pressable
      accessibilityLabel={`${node.name}, pinned`}
      accessibilityRole="button"
      accessibilityHint="Double tap to open. Long press for more actions."
      delayLongPress={350}
      onLongPress={() => onLongPress(node)}
      onPress={() => onOpen(node)}
      style={({ pressed }) => [rowStyle, pressed && pressedStyle]}
      testID={`pinned-file-${node.name}`}
    >
      {content}
    </Pressable>
  )
})
