import { requireNativeViewManager } from 'expo-modules-core'
import { useId, useRef } from 'react'
import { Platform, type ViewProps } from 'react-native'

type Selection = { enabled: boolean; revision: number; scope: string }
type NativeProps = ViewProps & {
  configuration: Selection & { available: boolean; hint: string }
  onSelectionChange: (event: { nativeEvent: Selection }) => void
}

const NativeAgentModeMenu = Platform.OS === 'ios'
  ? requireNativeViewManager<NativeProps>('PulpoFileClipboard', 'AgentModeMenuView')
  : (_props: NativeProps) => null

type Props = ViewProps & {
  enabled: boolean
  revision: number
  available: boolean
  hint: string
  onSelectionChange: (selection: { enabled: boolean; revision: number }) => void
}

export function AgentModeMenuView({ enabled, revision, available, hint, onSelectionChange, ...props }: Props) {
  const scope = useId()
  const receivedRevision = useRef(revision)

  return <NativeAgentModeMenu
    {...props}
    configuration={{ enabled, available, hint, scope, revision }}
    onSelectionChange={({ nativeEvent: selection }) => {
      if (selection.scope !== scope || selection.revision <= receivedRevision.current) return
      receivedRevision.current = selection.revision
      // Do not compare against the rendered enabled prop: several native taps
      // can arrive before React has committed any of their acknowledgements.
      // The composer must commit the value and revision together. A local
      // revision update could acknowledge this tap with an older enabled prop.
      onSelectionChange({ enabled: selection.enabled, revision: selection.revision })
    }}
  />
}
