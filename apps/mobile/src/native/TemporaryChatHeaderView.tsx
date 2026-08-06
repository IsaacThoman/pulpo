import { requireNativeViewManager } from 'expo-modules-core'
import type { ComponentProps } from 'react'
import type { ViewProps } from 'react-native'

type NativeEvent = { nativeEvent: Record<string, never> }

type TemporaryChatHeaderNativeProps = ViewProps & {
  active: boolean
  expanded: boolean
  saving: boolean
  saveDisabled: boolean
  reduceMotion: boolean
  onToggleTemporary: (event: NativeEvent) => void
  onSave: (event: NativeEvent) => void
  onNewChat: (event: NativeEvent) => void
}

const TemporaryChatHeaderNativeView = requireNativeViewManager<TemporaryChatHeaderNativeProps>(
  'PulpoFileClipboard',
  'TemporaryChatHeaderView',
)

export type TemporaryChatHeaderViewProps = Omit<
  ComponentProps<typeof TemporaryChatHeaderNativeView>,
  'onToggleTemporary' | 'onSave' | 'onNewChat'
> & {
  onToggleTemporary: () => void
  onSave: () => void
  onNewChat: () => void
}

export function TemporaryChatHeaderView({
  onToggleTemporary,
  onSave,
  onNewChat,
  ...props
}: TemporaryChatHeaderViewProps) {
  return (
    <TemporaryChatHeaderNativeView
      {...props}
      onToggleTemporary={onToggleTemporary}
      onSave={onSave}
      onNewChat={onNewChat}
    />
  )
}
