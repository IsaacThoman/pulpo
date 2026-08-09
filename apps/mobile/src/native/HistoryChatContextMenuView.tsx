import { requireNativeViewManager } from 'expo-modules-core'
import type { ComponentProps, ReactNode } from 'react'
import type { ViewProps } from 'react-native'

export type HistoryChatContextMenuAction =
  | 'share'
  | 'move'
  | 'delete'
  | 'pin'
  | 'rename'
  | 'duplicate'

type ActionEvent = {
  nativeEvent: {
    action: HistoryChatContextMenuAction
  }
}

type PressEvent = {
  nativeEvent: Record<string, never>
}

type HistoryChatContextMenuNativeProps = ViewProps & {
  children?: ReactNode
  pinned: boolean
  removeChatLabel: string
  previewTitle: string
  previewBody: string
  previewMetadata: string
  previewImageURI: string
  onAction: (event: ActionEvent) => void
  onPress: (event: PressEvent) => void
}

const HistoryChatContextMenuNativeView =
  requireNativeViewManager<HistoryChatContextMenuNativeProps>(
    'PulpoFileClipboard',
    'HistoryChatContextMenuView',
  )

export type HistoryChatContextMenuViewProps = Omit<
  ComponentProps<typeof HistoryChatContextMenuNativeView>,
  'onAction' | 'onPress'
> & {
  onAction: (action: HistoryChatContextMenuAction) => void
  onPress: () => void
}

export function HistoryChatContextMenuView({
  onAction,
  onPress,
  ...props
}: HistoryChatContextMenuViewProps) {
  return (
    <HistoryChatContextMenuNativeView
      {...props}
      onAction={(event) => onAction(event.nativeEvent.action)}
      onPress={() => onPress()}
    />
  )
}
