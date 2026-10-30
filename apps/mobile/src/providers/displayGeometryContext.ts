import { createContext, useContext, useMemo } from 'react'
import { I18nManager, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  EMPTY_DISPLAY_GEOMETRY,
  resolveVerticalBar,
  resolveVerticalFold,
  type DisplayGeometry,
  type VerticalBar,
  type VerticalFold,
} from '../displayGeometry'

export const DisplayGeometryContext = createContext<DisplayGeometry>(EMPTY_DISPLAY_GEOMETRY)

export function useDisplayGeometry(): DisplayGeometry {
  return useContext(DisplayGeometryContext)
}

/** The column iOS reserves for its vertical bar, or null when there is none. */
export function useVerticalBar(): VerticalBar | null {
  const geometry = useDisplayGeometry()
  const { top, left, right } = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  return useMemo(
    () => resolveVerticalBar(geometry, { top, left, right }, width, I18nManager.isRTL),
    [geometry, left, right, top, width],
  )
}

/** The hinge while the device is half open, or null. */
export function useVerticalFold(): VerticalFold | null {
  const geometry = useDisplayGeometry()
  const { height, width } = useWindowDimensions()
  return useMemo(() => resolveVerticalFold(geometry, width, height), [geometry, height, width])
}
