import { requireNativeViewManager } from 'expo-modules-core'
import { Platform, StyleSheet, type ViewProps } from 'react-native'
import { EMPTY_DISPLAY_GEOMETRY, type DisplayDivision, type DisplayGeometry, type DisplayRect } from '../displayGeometry'

type NativeGeometryEvent = { nativeEvent: Partial<DisplayGeometry> }

const NativeDisplayGeometryView = Platform.OS === 'ios' ? requireNativeViewManager<ViewProps & {
  onGeometryChange: (event: NativeGeometryEvent) => void
}>('PulpoFileClipboard', 'DisplayGeometryView') : null

function rect(value: Partial<DisplayRect>): DisplayRect {
  return { x: value.x ?? 0, y: value.y ?? 0, width: value.width ?? 0, height: value.height ?? 0 }
}

function division(value: Partial<DisplayDivision>): DisplayDivision {
  const margins = value.margins ?? EMPTY_MARGINS
  return { ...rect(value), margins: { ...EMPTY_MARGINS, ...margins } }
}

const EMPTY_MARGINS = { top: 0, left: 0, bottom: 0, right: 0 }

/** Fills the window, invisibly, to report its display geometry. iOS only. */
export function DisplayGeometryView({ onChange }: { onChange: (geometry: DisplayGeometry) => void }) {
  if (!NativeDisplayGeometryView) return null
  return (
    <NativeDisplayGeometryView
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onGeometryChange={({ nativeEvent }) => onChange({
        verticalBarEdge: nativeEvent.verticalBarEdge ?? EMPTY_DISPLAY_GEOMETRY.verticalBarEdge,
        occlusions: (nativeEvent.occlusions ?? []).map(rect),
        divisions: (nativeEvent.divisions ?? []).map(division),
      })}
    />
  )
}
