import { requireNativeViewManager } from 'expo-modules-core'
import { useState } from 'react'
import type { ViewProps } from 'react-native'

export type QueueAction = {
  id: string
  action: 'edit' | 'delete' | 'reorder' | 'retry'
  targetMessageId?: string
  edge?: 'before' | 'after'
}

type Props = ViewProps & {
  rows: Array<{
    id: string
    kind?: 'shelf'
    canRetry?: boolean
    content: string
    detail: string
    status: string
    isEditing: boolean
    canEdit: boolean
    canDelete: boolean
    canReorder: boolean
  }>
  onContentHeightChange: (event: { nativeEvent: { height: number } }) => void
  onAction: (event: { nativeEvent: QueueAction }) => void
}

const NativeQueuedMessagesView = requireNativeViewManager<Props>(
  'PulpoFileClipboard',
  'QueuedMessagesView',
)


export function QueuedMessagesView({
  maxHeight,
  style,
  ...props
}: Omit<Props, 'onContentHeightChange'> & { maxHeight: number }) {
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  return (
    <NativeQueuedMessagesView
      {...props}
      style={[style, { height: Math.min(contentHeight ?? props.rows.length * 56, maxHeight) }]}
      onContentHeightChange={({ nativeEvent: { height } }) => {
        if (Number.isFinite(height) && height >= 0) setContentHeight(height)
      }}
    />
  )
}
