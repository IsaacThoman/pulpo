import { requireNativeViewManager } from 'expo-modules-core'
import { Platform, type ViewProps } from 'react-native'

const NativeStatusBarGradientView = Platform.OS === 'ios' ? requireNativeViewManager<ViewProps>(
  'PulpoFileClipboard',
  'StatusBarGradientView',
) : (_props: ViewProps) => null

export function StatusBarGradientView({ style }: Pick<ViewProps, 'style'>) {
  return (
    <NativeStatusBarGradientView
      style={style}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  )
}
