import { requireNativeViewManager } from 'expo-modules-core'
import { useRef, type ReactNode } from 'react'
import { Platform, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import type { PastedFiles } from '../features/chat/pastedFileAttachments'

type NativePasteFiles = Partial<PastedFiles> & { id?: string }

const NativeComposerPasteView = Platform.OS === 'ios' ? requireNativeViewManager<ViewProps & {
  onPasteStart: (event: { nativeEvent: { id?: string } }) => void
  onPasteFiles: (event: { nativeEvent: NativePasteFiles }) => void
}>('PulpoFileClipboard', 'ComposerPasteView') : null

/**
 * Lets the text input inside it take pasted images and files, which iOS text
 * inputs otherwise refuse to paste. Elsewhere it renders the input unchanged.
 *
 * Saving pasted files takes a moment, and the composer may show another draft
 * by then, so `pasteContext` is read as the paste starts and handed back with
 * its files.
 */
export function ComposerPasteView<Context>({ children, onPasteFiles, pasteContext, style }: {
  children: ReactNode
  onPasteFiles: (pasted: PastedFiles, context: Context) => void
  pasteContext: () => Context
  style?: StyleProp<ViewStyle>
}) {
  const pending = useRef(new Map<string, Context>())
  if (!NativeComposerPasteView) return children
  return (
    <NativeComposerPasteView
      style={style}
      onPasteStart={({ nativeEvent }) => {
        if (nativeEvent.id) pending.current.set(nativeEvent.id, pasteContext())
      }}
      onPasteFiles={({ nativeEvent }) => {
        const { id } = nativeEvent
        if (!id || !pending.current.has(id)) return
        const context = pending.current.get(id) as Context
        pending.current.delete(id)
        onPasteFiles({ files: nativeEvent.files ?? [], failed: nativeEvent.failed ?? 0 }, context)
      }}
    >
      {children}
    </NativeComposerPasteView>
  )
}
