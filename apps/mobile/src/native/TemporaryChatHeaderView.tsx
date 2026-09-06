import { requireNativeViewManager } from 'expo-modules-core'
import type { ComponentProps } from 'react'
import { Platform, type ViewProps } from 'react-native'

type NativeEvent = { nativeEvent: Record<string, never> }

type TemporaryChatHeaderNativeProps = ViewProps & {
  active: boolean
  expanded: boolean
  expirationEnabled: boolean
  leadingAction: 'none' | 'expiration' | 'save'
  saving: boolean
  saveDisabled: boolean
  reduceMotion: boolean
  trailingAction: 'ghost' | 'new-chat'
  onToggleExpiration: (event: NativeEvent) => void
  onToggleTemporary: (event: NativeEvent) => void
  onSave: (event: NativeEvent) => void
  onNewChat: (event: NativeEvent) => void
}

const TemporaryChatHeaderNativeView = Platform.OS === 'ios' ? requireNativeViewManager<TemporaryChatHeaderNativeProps>(
  'PulpoFileClipboard',
  'TemporaryChatHeaderView',
) : (_props: TemporaryChatHeaderNativeProps) => null


export type TemporaryChatHeaderViewProps = Omit<
  ComponentProps<typeof TemporaryChatHeaderNativeView>,
  'onToggleExpiration' | 'onToggleTemporary' | 'onSave' | 'onNewChat'
> & {
  onToggleExpiration: () => void
  onToggleTemporary: () => void
  onSave: () => void
  onNewChat: () => void
}

export function TemporaryChatHeaderView({
  onToggleExpiration,
  onToggleTemporary,
  onSave,
  onNewChat,
  ...props
}: TemporaryChatHeaderViewProps) {
  return (
    <TemporaryChatHeaderNativeView
      {...props}
      onToggleExpiration={onToggleExpiration}
      onToggleTemporary={onToggleTemporary}
      onSave={onSave}
      onNewChat={onNewChat}
    />
  )
}
