import { requireNativeViewManager } from 'expo-modules-core'
import type { ReactNode } from 'react'
import { Platform, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'

export interface ContextMenuAction {
  id: string
  title: string
  /** SF Symbol name (mapped to Material on Android by callers that need it). */
  systemImage?: string
  /** Actions are grouped by section, separated by lines; ascending. */
  section?: number
  destructive?: boolean
  disabled?: boolean
  checked?: boolean
  /** Shown inside the submenu of the action with this id. */
  parent?: string
}

export interface ContextMenuPreview {
  title: string
  subtitle?: string
  systemImage?: string
  tint?: string
  imageURI?: string
}

type NativeProps = ViewProps & {
  actions: Array<Required<Omit<ContextMenuAction, 'parent'>> & { parent: string }>
  preview: Required<ContextMenuPreview>
  pressEnabled: boolean
  onAction: (event: { nativeEvent: { id: string } }) => void
  onItemPress: () => void
  children?: ReactNode
}

const NativeItemContextMenu = Platform.OS === 'ios'
  ? requireNativeViewManager<NativeProps>('PulpoFileClipboard', 'ItemContextMenuView')
  : null

/** Whether this binary has the native menu view; older binaries fall back to a plain row. */
export const itemContextMenuAvailable = NativeItemContextMenu !== null

/**
 * A row with a native long-press menu and preview (iOS). `children` is drawn but not touched:
 * the native view reports taps.
 */
export function ItemContextMenuView({ actions, preview, onAction, onPress, style, children, ...props }: ViewProps & {
  actions: ContextMenuAction[]
  preview?: ContextMenuPreview
  onAction: (id: string) => void
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}) {
  if (!NativeItemContextMenu) return null
  return (
    <NativeItemContextMenu
      {...props}
      style={style}
      actions={actions.map((action) => ({
        id: action.id,
        title: action.title,
        systemImage: action.systemImage ?? '',
        section: action.section ?? 0,
        destructive: action.destructive ?? false,
        disabled: action.disabled ?? false,
        checked: action.checked ?? false,
        parent: action.parent ?? '',
      }))}
      preview={{ title: preview?.title ?? '', subtitle: preview?.subtitle ?? '', systemImage: preview?.systemImage ?? '', tint: preview?.tint ?? '', imageURI: preview?.imageURI ?? '' }}
      pressEnabled={onPress !== undefined}
      onAction={({ nativeEvent }) => onAction(nativeEvent.id)}
      onItemPress={() => onPress?.()}
    >
      {children}
    </NativeItemContextMenu>
  )
}
