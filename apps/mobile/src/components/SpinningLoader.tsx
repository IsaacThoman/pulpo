import { useEffect, type ReactNode } from 'react'
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { Loader2, type LucideProps } from 'lucide-react-native'

export const SPINNER_REVOLUTION_MS = 1000
export const PULSE_CYCLE_MS = 2000

/** Native counterpart to web's `animate-spin`; lucide icons are static SVGs on native. */
export function SpinningLoader({ color, size, reduceMotion = false }: { color: LucideProps['color']; size: number; reduceMotion?: boolean }) {
  const rotation = useSharedValue(0)
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))

  useEffect(() => {
    cancelAnimation(rotation)
    rotation.value = 0
    if (reduceMotion) return undefined
    rotation.value = withRepeat(withTiming(360, { duration: SPINNER_REVOLUTION_MS, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(rotation)
  }, [reduceMotion, rotation])

  return (
    <Reanimated.View style={[{ width: size, height: size }, animatedStyle]}>
      <Loader2 color={color} size={size} />
    </Reanimated.View>
  )
}

/** Native counterpart to web's `animate-pulse` for in-progress activity icons. */
export function PulsingIcon({ children, reduceMotion = false }: { children: ReactNode; reduceMotion?: boolean }) {
  const opacity = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  useEffect(() => {
    cancelAnimation(opacity)
    opacity.value = 1
    if (reduceMotion) return undefined
    const half = { duration: PULSE_CYCLE_MS / 2, easing: Easing.bezier(0.4, 0, 0.6, 1) }
    opacity.value = withRepeat(withSequence(withTiming(0.5, half), withTiming(1, half)), -1, false)
    return () => cancelAnimation(opacity)
  }, [opacity, reduceMotion])

  return <Reanimated.View style={animatedStyle}>{children}</Reanimated.View>
}
