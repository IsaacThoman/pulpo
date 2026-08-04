import { useCallback, useEffect, useMemo, useState } from 'react'
import { AccessibilityInfo, Keyboard, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useAppTheme } from '../../theme'
import { ChatScreen } from './ChatScreen'
import { HistoryDrawer } from './HistoryDrawer'

const DRAWER_PEEK = 64
const SPRING = { damping: 26, stiffness: 240, mass: 0.9, overshootClamping: true }

export function MemberShell({ chatId }: { chatId?: string }) {
  const theme = useAppTheme()
  const { width } = useWindowDimensions()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const slideX = useSharedValue(0)
  const gestureStartX = useSharedValue(0)
  const openOffset = Math.max(0, width - DRAWER_PEEK)

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (drawerOpen) slideX.value = openOffset
  }, [drawerOpen, openOffset, slideX])

  const animateDrawer = useCallback((open: boolean, velocity = 0) => {
    setDrawerOpen(open)
    if (open) Keyboard.dismiss()
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const target = open ? openOffset : 0
    slideX.value = reduceMotion ? target : withSpring(target, { ...SPRING, velocity })
  }, [openOffset, reduceMotion, slideX])

  const finishGesture = useCallback((open: boolean) => {
    setDrawerOpen(open)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  const dismissKeyboard = useCallback(() => { Keyboard.dismiss() }, [])

  const settleGesture = useCallback((velocityX: number) => {
    'worklet'
    const open = velocityX > 500 ? true : velocityX < -500 ? false : slideX.value > openOffset * 0.45
    const target = open ? openOffset : 0
    slideX.value = reduceMotion ? target : withSpring(target, { ...SPRING, velocity: velocityX })
    runOnJS(finishGesture)(open)
  }, [finishGesture, openOffset, reduceMotion, slideX])

  const openGesture = useMemo(() => Gesture.Pan()
    .enabled(!drawerOpen)
    .activeOffsetX(10)
    .failOffsetY([-12, 12])
    .onStart(() => {
      gestureStartX.value = slideX.value
      runOnJS(dismissKeyboard)()
    })
    .onUpdate((event) => {
      slideX.value = Math.max(0, Math.min(openOffset, gestureStartX.value + event.translationX))
    })
    .onEnd((event) => settleGesture(event.velocityX)), [dismissKeyboard, drawerOpen, gestureStartX, openOffset, settleGesture, slideX])

  const closeGesture = useMemo(() => Gesture.Pan()
    .enabled(drawerOpen)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onStart(() => { gestureStartX.value = slideX.value })
    .onUpdate((event) => {
      slideX.value = Math.max(0, Math.min(openOffset, gestureStartX.value + event.translationX))
    })
    .onEnd((event) => settleGesture(event.velocityX)), [drawerOpen, gestureStartX, openOffset, settleGesture, slideX])

  const drawerGesture = useMemo(() => Gesture.Simultaneous(openGesture, closeGesture), [closeGesture, openGesture])
  const foregroundStyle = useAnimatedStyle(() => {
    const progress = openOffset ? slideX.value / openOffset : 0
    return { transform: [{ translateX: slideX.value }, { scale: reduceMotion ? 1 : interpolate(progress, [0, 1], [1, 0.965]) }] }
  }, [openOffset, reduceMotion])
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reduceMotion ? 0 : interpolate(slideX.value, [0, openOffset], [-36, 0]) }],
  }), [openOffset, reduceMotion])

  const selectChat = (id: string) => {
    animateDrawer(false)
    setTimeout(() => router.replace({ pathname: '/(member)/chat/[id]', params: { id } }), 120)
  }
  const newChat = () => {
    animateDrawer(false)
    setTimeout(() => router.replace('/(member)/chat/new'), 120)
  }
  const openSettings = () => {
    animateDrawer(false)
    setTimeout(() => router.push('/(member)/settings'), 120)
  }

  return <View style={[styles.root, { backgroundColor: theme.background }]}> 
    <Reanimated.View
      accessibilityElementsHidden={!drawerOpen}
      importantForAccessibility={!drawerOpen ? 'no-hide-descendants' : 'auto'}
      style={[StyleSheet.absoluteFill, drawerStyle]}
    >
      <HistoryDrawer activeChatId={chatId} drawerOpen={drawerOpen} onSelectChat={selectChat} onNewChat={newChat} onOpenSettings={openSettings} />
    </Reanimated.View>
    <GestureDetector gesture={drawerGesture}>
      <Reanimated.View
        accessibilityElementsHidden={drawerOpen}
        importantForAccessibility={drawerOpen ? 'no-hide-descendants' : 'auto'}
        style={[styles.foreground, { backgroundColor: theme.background, shadowColor: theme.shadow }, foregroundStyle]}
      >
        <ChatScreen chatId={chatId} onOpenPanel={() => animateDrawer(true)} onNewChat={newChat} />
        {drawerOpen ? <Pressable accessibilityLabel="Close chats" accessibilityRole="button" onPress={() => animateDrawer(false)} style={styles.scrim} /> : null}
      </Reanimated.View>
    </GestureDetector>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  foreground: { position: 'absolute', inset: 0, borderTopLeftRadius: 38, borderBottomLeftRadius: 38, overflow: 'hidden', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: -10, height: 0 } },
  scrim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.12)' },
})
