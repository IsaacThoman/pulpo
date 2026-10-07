import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native'
import { useTVTheme } from '../theme'

export interface FocusableProps extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode | ((focused: boolean) => ReactNode)
  style?: StyleProp<ViewStyle>
  /** Background when focused; defaults to the inverse surface used by tvOS. */
  focusedStyle?: StyleProp<ViewStyle>
  /** How much the control grows when focused. */
  lift?: number
}

/** A pressable that rises and inverts when the Siri Remote focuses it. */
export const Focusable = forwardRef<View, FocusableProps>(function Focusable(
  { children, style, focusedStyle, lift = 1.06, hasTVPreferredFocus = false, onFocus, onBlur, ...props },
  ref,
) {
  const theme = useTVTheme()
  const [focused, setFocused] = useState(false)
  const scale = useRef(new Animated.Value(1)).current
  // Request preferred focus once mounted (a new screen can otherwise inherit
  // focus from where the previous one left it), and drop the request once
  // granted: tvOS re-claims a preferred view's focus on every layout pass.
  // A request made while tvOS is still settling focus (a closing keyboard, a
  // screen change) is dropped, so retry briefly until focus arrives.
  const [preferred, setPreferred] = useState(false)
  const granted = useRef(false)
  useEffect(() => {
    granted.current = false
    if (!hasTVPreferredFocus) { setPreferred(false); return }
    setPreferred(true)
    let attempts = 0
    const timer = setInterval(() => {
      if (granted.current || ++attempts > 5) { clearInterval(timer); return }
      setPreferred(false)
      requestAnimationFrame(() => { if (!granted.current) setPreferred(true) })
    }, 350)
    return () => clearInterval(timer)
  }, [hasTVPreferredFocus])
  const animate = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 4 }).start()
  return <Pressable
    ref={ref}
    {...props}
    hasTVPreferredFocus={preferred}
    onFocus={(event) => { setFocused(true); granted.current = true; setPreferred(false); animate(lift); onFocus?.(event) }}
    onBlur={(event) => { setFocused(false); animate(1); onBlur?.(event) }}
  >
    <Animated.View style={[
      { backgroundColor: theme.card, borderRadius: 20 },
      style,
      focused && [{
        backgroundColor: theme.focus,
        shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 14 },
      }, focusedStyle],
      { transform: [{ scale }] },
    ]}>
      {typeof children === 'function' ? children(focused) : children}
    </Animated.View>
  </Pressable>
})
