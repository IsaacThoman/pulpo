import type { FileAccessMode } from '@pulpo/contracts'
import { requireNativeViewManager } from 'expo-modules-core'
import { useId, useRef } from 'react'
import { Platform, type ViewProps } from 'react-native'

type Selection = { enabled: boolean; revision: number; scope: string }
type FilesConfiguration = {
  /** Shows "Changes to Files": Files on, not a temporary chat. */
  filesVisible: boolean
  fileChangeMode: FileAccessMode
  /** Shows "Files Access…", for a saved chat. */
  filesAccessVisible: boolean
}
type FilesActionEvent = { scope: string; action: 'mode' | 'access'; mode?: string }
type NativeProps = ViewProps & {
  configuration: Selection & FilesConfiguration & { available: boolean; hint: string }
  onSelectionChange: (event: { nativeEvent: Selection }) => void
  onFilesAction?: (event: { nativeEvent: FilesActionEvent }) => void
}

const NativeAgentModeMenu = Platform.OS === 'ios'
  ? requireNativeViewManager<NativeProps>('PulpoFileClipboard', 'AgentModeMenuView')
  : (_props: NativeProps) => null

const FILE_ACCESS_MODES: readonly string[] = ['read', 'suggest', 'write']

type Props = ViewProps & {
  enabled: boolean
  revision: number
  available: boolean
  hint: string
  onSelectionChange: (selection: { enabled: boolean; revision: number }) => void
  /** The menu's Files choices; omitted, the menu has none. */
  files?: {
    changeMode: FileAccessMode
    onChangeMode: (mode: FileAccessMode) => void
    /** Opens what the agent can use from Files in this chat; omitted for the unsent chat. */
    onOpenAccess?: () => void
  }
}

export function AgentModeMenuView({ enabled, revision, available, hint, onSelectionChange, files, ...props }: Props) {
  const scope = useId()
  const receivedRevision = useRef(revision)

  return <NativeAgentModeMenu
    {...props}
    configuration={{
      enabled, available, hint, scope, revision,
      filesVisible: Boolean(files),
      fileChangeMode: files?.changeMode ?? 'suggest',
      filesAccessVisible: Boolean(files?.onOpenAccess),
    }}
    onSelectionChange={({ nativeEvent: selection }) => {
      if (selection.scope !== scope || selection.revision <= receivedRevision.current) return
      receivedRevision.current = selection.revision
      // Do not compare against the rendered enabled prop: several native taps
      // can arrive before React has committed any of their acknowledgements.
      // The composer must commit the value and revision together. A local
      // revision update could acknowledge this tap with an older enabled prop.
      onSelectionChange({ enabled: selection.enabled, revision: selection.revision })
    }}
    onFilesAction={({ nativeEvent: event }) => {
      if (event.scope !== scope || !files) return
      if (event.action === 'access') files.onOpenAccess?.()
      else if (event.mode && FILE_ACCESS_MODES.includes(event.mode)) files.onChangeMode(event.mode as FileAccessMode)
    }}
  />
}
