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
  | 'enable-expiration'
  | 'disable-expiration'

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
  expirationAction: 'hidden' | 'enable' | 'disable'
  expirationPeriodLabel: string
  expiresAt: number
  previewTitle: string
  previewBody: string
  previewMetadata: string
  onAction: (event: ActionEvent) => void
  onChatPress: (event: PressEvent) => void
  onPreviewRequest: (event: PressEvent) => void
}

const HistoryChatContextMenuNativeView =
  requireNativeViewManager<HistoryChatContextMenuNativeProps>(
    'PulpoFileClipboard',
    'HistoryChatContextMenuView',
  )

export type HistoryChatContextMenuViewProps = Omit<
  ComponentProps<typeof HistoryChatContextMenuNativeView>,
  'onAction' | 'onChatPress' | 'onPreviewRequest'
> & {
  onAction: (action: HistoryChatContextMenuAction) => void
  onPress: () => void
  onPreviewRequest: () => void
}

export function HistoryChatContextMenuView({
  onAction,
  onPress,
  onPreviewRequest,
  ...props
}: HistoryChatContextMenuViewProps) {
  return (
    <HistoryChatContextMenuNativeView
      {...props}
      onAction={(event) => onAction(event.nativeEvent.action)}
      onChatPress={() => onPress()}
      onPreviewRequest={() => onPreviewRequest()}
    />
  )
}
