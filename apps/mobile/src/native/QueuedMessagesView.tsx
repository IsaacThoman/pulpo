import { requireNativeViewManager } from 'expo-modules-core'
import type { ViewProps } from 'react-native'

export type QueueAction = {
  id: string
  action: 'edit' | 'delete' | 'reorder'
  targetMessageId?: string
  edge?: 'before' | 'after'
}

type Props = ViewProps & {
  rows: Array<{
    id: string
    content: string
    detail: string
    status: string
    canEdit: boolean
    canDelete: boolean
    canReorder: boolean
  }>
  onAction: (event: { nativeEvent: QueueAction }) => void
}

export const QueuedMessagesView = requireNativeViewManager<Props>(
  'PulpoFileClipboard',
  'QueuedMessagesView',
)
