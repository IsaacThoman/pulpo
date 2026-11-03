import { requireNativeViewManager } from 'expo-modules-core'
import type { ReactNode } from 'react'
import { Platform, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import type { PastedFiles } from '../features/chat/pastedFileAttachments'

const NativeComposerPasteView = Platform.OS === 'ios' ? requireNativeViewManager<ViewProps & {
  onPasteFiles: (event: { nativeEvent: Partial<PastedFiles> }) => void
}>('PulpoFileClipboard', 'ComposerPasteView') : null

/**
 * Lets the text input inside it take pasted images and files, which iOS text
 * inputs otherwise refuse to paste. Elsewhere it renders the input unchanged.
 */
export function ComposerPasteView({ children, onPasteFiles, style }: {
  children: ReactNode
  onPasteFiles: (pasted: PastedFiles) => void
  style?: StyleProp<ViewStyle>
}) {
  if (!NativeComposerPasteView) return children
  return (
    <NativeComposerPasteView
      style={style}
      onPasteFiles={({ nativeEvent }) => onPasteFiles({ files: nativeEvent.files ?? [], failed: nativeEvent.failed ?? 0 })}
    >
      {children}
    </NativeComposerPasteView>
  )
}
