import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { Eye, EyeOff, SendHorizontal } from 'lucide-react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { WorkspaceScreenInputEventInput } from '@pulpo/contracts'
import { usePreferencesStore } from '../../store/preferences'
import { useAppTheme, type AppTheme } from '../../theme'
import { fetchWorkspaceScreenFrame, fetchWorkspaceScreenStatus, isNotControlledError, postWorkspaceScreenControl, postWorkspaceScreenInput } from './api'
import { ControlSession } from './control'
import { clearFrames, deleteFrame, writeFrame } from './frameFiles'
import { startFrameLoop } from './frameLoop'
import {
  clampTransform,
  DOUBLE_TAP_ZOOM,
  fittedSize,
  pinchTransform,
  screenPoint,
  scrollNotches,
  type Size,
} from './geometry'
import { InputQueue, textEvents } from './inputQueue'
import { useWorkspaceScreenViewer } from './store'

export const WORKSPACE_SCREEN_TITLE = 'Workspace screen'
export const WORKSPACE_SCREEN_NONE_TEXT = "No workspace is running for this chat. The screen is there while the agent's workspace is, and goes when the workspace shuts down after sitting idle."
export const WORKSPACE_SCREEN_UNAVAILABLE_TEXT = 'This workspace has no screen.'
const CONTROL_LOST_TEXT = "Control ended, so you're watching again."
const CONTROL_REFUSED_TEXT = "Couldn't take control. Try again."
const INPUT_FAILED_TEXT = "Couldn't send that to the workspace."

/** The keys a phone keyboard has no way to send, in the app tools' words. */
const KEYS: Array<{ keys: string; label: string; accessibilityLabel: string }> = [
  { keys: 'enter', label: 'Enter', accessibilityLabel: 'Enter' },
  { keys: 'backspace', label: 'Backspace', accessibilityLabel: 'Backspace' },
  { keys: 'tab', label: 'Tab', accessibilityLabel: 'Tab' },
  { keys: 'escape', label: 'Esc', accessibilityLabel: 'Escape' },
  { keys: 'left', label: '←', accessibilityLabel: 'Left arrow' },
  { keys: 'up', label: '↑', accessibilityLabel: 'Up arrow' },
  { keys: 'down', label: '↓', accessibilityLabel: 'Down arrow' },
  { keys: 'right', label: '→', accessibilityLabel: 'Right arrow' },
]

type Layers = { front: string | null; next: string | null; waiting: string | null }

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; screen: Size }

/**
 * The live picture of a chat's workspace screen. The owner watches what the agent does on it and
 * can take it over, to sign in to a site for example, then hand it back.
 */
export function WorkspaceScreenViewer({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const theme = useAppTheme()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setPhase({ kind: 'loading' })
    void fetchWorkspaceScreenStatus(chatId, controller.signal).then((status) => {
      if (controller.signal.aborted) return
      if (status.state === 'ready') setPhase({ kind: 'ready', screen: { width: status.width, height: status.height } })
      else setPhase({ kind: status.state })
    }).catch((error) => {
      if (controller.signal.aborted) return
      setPhase({ kind: 'error', message: error instanceof Error && error.message ? error.message : "Couldn't open the screen." })
    })
    return () => controller.abort()
  }, [attempt, chatId])

  useEffect(() => () => clearFrames(), [])

  const onGone = useCallback(() => setPhase({ kind: 'none' }), [])

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      supportedOrientations={Platform.OS === 'ios' && Platform.isPad
        ? ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']
        : ['portrait']}
    >
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaView onAccessibilityEscape={onClose} edges={['top', 'bottom', 'left', 'right']} style={[styles.flex, { backgroundColor: theme.background }]}>
          <View style={[styles.header, { borderBottomColor: theme.separator }]}>
            <View style={styles.headerSide} />
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.text }]}>{WORKSPACE_SCREEN_TITLE}</Text>
            <Pressable accessibilityRole="button" hitSlop={10} onPress={onClose} style={[styles.headerSide, styles.headerTrailing]}>
              <Text style={[styles.headerButton, { color: theme.blue }]}>Done</Text>
            </Pressable>
          </View>
          {phase.kind === 'ready' ? (
            <LiveScreen chatId={chatId} screen={phase.screen} onGone={onGone} theme={theme} />
          ) : (
            <View style={styles.message}>
              {phase.kind === 'loading' ? <ActivityIndicator accessibilityLabel="Loading the screen" color={theme.secondary} /> : null}
              {phase.kind === 'none' ? <Text style={[styles.messageText, { color: theme.secondary }]}>{WORKSPACE_SCREEN_NONE_TEXT}</Text> : null}
              {phase.kind === 'unavailable' ? <Text style={[styles.messageText, { color: theme.secondary }]}>{WORKSPACE_SCREEN_UNAVAILABLE_TEXT}</Text> : null}
              {phase.kind === 'error' ? (
                <>
                  <Text style={[styles.messageText, { color: theme.secondary }]}>{phase.message}</Text>
                  <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={({ pressed }) => [styles.button, styles.retryButton, { backgroundColor: theme.fillStrong }, pressed && styles.pressed]}>
                    <Text style={[styles.buttonText, { color: theme.text }]}>Try again</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          )}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  )
}

/** Shows the viewer for the chat it was opened for, while the chat screen is there. */
export function WorkspaceScreenHost() {
  const chatId = useWorkspaceScreenViewer((state) => state.chatId)
  const close = useWorkspaceScreenViewer((state) => state.close)
  useEffect(() => close, [close])
  return chatId ? <WorkspaceScreenViewer chatId={chatId} onClose={close} /> : null
}

function useForeground(): boolean {
  // `inactive` is iOS covering the app for a moment (Control Center, a call banner); only leaving it pauses.
  const [foreground, setForeground] = useState(AppState.currentState !== 'background')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state !== 'background'))
    return () => subscription.remove()
  }, [])
  return foreground
}

function LiveScreen({ chatId, screen, onGone, theme }: { chatId: string; screen: Size; onGone: () => void; theme: AppTheme }) {
  const foreground = useForeground()
  const [connected, setConnected] = useState(true)
  const [held, setHeld] = useState(false)
  const [taking, setTaking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [hideText, setHideText] = useState(false)

  // Two picture layers: a new frame loads hidden on top and replaces the shown one once decoded.
  // A frame that arrives while another is still loading waits for it (only the newest waits), so
  // the picture keeps changing even when frames come faster than they decode.
  const [layers, setLayers] = useState<Layers>({ front: null, next: null, waiting: null })
  const layersRef = useRef(layers)
  const written = useRef(new Set<string>())
  const showLayers = useCallback((value: Layers) => {
    layersRef.current = value
    setLayers(value)
  }, [])
  useEffect(() => {
    for (const uri of written.current) {
      if (uri === layers.front || uri === layers.next || uri === layers.waiting) continue
      deleteFrame(uri)
      written.current.delete(uri)
    }
  }, [layers])

  const session = useRef<{ control: ControlSession; input: InputQueue } | null>(null)
  if (!session.current) {
    const control = new ControlSession({
      post: (value) => postWorkspaceScreenControl(chatId, value),
      onChange: (value, loss) => {
        setHeld(value)
        if (value) return
        session.current?.input.clear()
        setText('')
        if (loss) setNotice(CONTROL_LOST_TEXT)
      },
    })
    const input = new InputQueue({
      send: (events) => postWorkspaceScreenInput(chatId, events),
      onError: (error) => {
        if (isNotControlledError(error)) control.lose()
        else setNotice(INPUT_FAILED_TEXT)
      },
    })
    session.current = { control, input }
  }
  const { control, input } = session.current

  useEffect(() => () => {
    control.release()
    input.clear()
  }, [control, input])
  useEffect(() => {
    if (!foreground) control.release()
  }, [control, foreground])

  useEffect(() => {
    if (!foreground) return
    const loop = startFrameLoop({
      fetchFrame: (after, waitMs, signal) => fetchWorkspaceScreenFrame(chatId, after, waitMs, signal),
      onFrame: ({ bytes }) => {
        let uri: string
        try {
          uri = writeFrame(bytes)
        } catch {
          return
        }
        written.current.add(uri)
        const current = layersRef.current
        showLayers(current.next ? { ...current, waiting: uri } : { ...current, next: uri })
      },
      onGone,
      onConnection: setConnected,
    })
    return () => {
      loop.stop()
      setConnected(true)
    }
  }, [chatId, foreground, onGone, showLayers])

  const promote = useCallback((uri: string) => {
    const current = layersRef.current
    if (current.next !== uri) return
    showLayers({ front: uri, next: current.waiting, waiting: null })
  }, [showLayers])
  const dropNext = useCallback((uri: string) => {
    const current = layersRef.current
    if (current.next !== uri) return
    showLayers({ front: current.front, next: current.waiting, waiting: null })
  }, [showLayers])

  // The view: the picture fitted into the viewport, then zoomed and moved by the user.
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const viewportWidth = useSharedValue(0)
  const viewportHeight = useSharedValue(0)
  const scale = useSharedValue(1)
  const offsetX = useSharedValue(0)
  const offsetY = useSharedValue(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setViewport({ width, height })
    viewportWidth.value = width
    viewportHeight.value = height
    const next = clampTransform({ scale: scale.value, x: offsetX.value, y: offsetY.value }, { width, height }, fittedSize({ width, height }, screen))
    scale.value = next.scale
    offsetX.value = next.x
    offsetY.value = next.y
  }, [offsetX, offsetY, scale, screen, viewportHeight, viewportWidth])
  const fitted = fittedSize(viewport, screen)
  const pictureStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: scale.value }],
  }))

  const pointAt = useCallback((x: number, y: number) => screenPoint(
    { x, y },
    { scale: scale.value, x: offsetX.value, y: offsetY.value },
    { width: viewportWidth.value, height: viewportHeight.value },
    screen,
  ), [offsetX, offsetY, scale, screen, viewportHeight, viewportWidth])
  const send = useCallback((event: WorkspaceScreenInputEventInput) => {
    if (!control.isHeld) return
    setNotice(null)
    input.push(event)
  }, [control, input])
  const clickAt = useCallback((x: number, y: number, button: 'left' | 'right') => {
    const point = pointAt(x, y)
    if (!point) return
    if (button === 'right' && usePreferencesStore.getState().haptics) void Haptics.selectionAsync()
    send({ type: 'click', x: point.x, y: point.y, button, count: 1 })
  }, [pointAt, send])
  const scrollAt = useCallback((x: number, y: number, dx: number, dy: number) => {
    const point = pointAt(x, y)
    if (point) send({ type: 'scroll', x: point.x, y: point.y, dx, dy })
  }, [pointAt, send])

  // Two fingers move the view: they pinch to zoom, and the picture follows their middle.
  const twoFingers = useSharedValue(0)
  const startScale = useSharedValue(1)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  const focalX = useSharedValue(0)
  const focalY = useSharedValue(0)
  const pinchScale = useSharedValue(1)
  const panX = useSharedValue(0)
  const panY = useSharedValue(0)
  const beginTwoFingers = (x: number, y: number) => {
    'worklet'
    if (twoFingers.value === 0) {
      startScale.value = scale.value
      startX.value = offsetX.value
      startY.value = offsetY.value
      focalX.value = x
      focalY.value = y
      pinchScale.value = 1
      panX.value = 0
      panY.value = 0
    }
    twoFingers.value += 1
  }
  const applyTwoFingers = () => {
    'worklet'
    const viewportSize = { width: viewportWidth.value, height: viewportHeight.value }
    const next = pinchTransform(
      { scale: startScale.value, x: startX.value, y: startY.value },
      { x: focalX.value, y: focalY.value },
      { x: focalX.value + panX.value, y: focalY.value + panY.value },
      pinchScale.value,
      viewportSize,
      fittedSize(viewportSize, screen),
    )
    scale.value = next.scale
    offsetX.value = next.x
    offsetY.value = next.y
  }
  const endTwoFingers = () => {
    'worklet'
    twoFingers.value = Math.max(0, twoFingers.value - 1)
  }
  const pinching = useSharedValue(false)
  const twoFingerPanning = useSharedValue(false)
  const pinch = Gesture.Pinch()
    .onStart((event) => {
      pinching.value = true
      beginTwoFingers(event.focalX, event.focalY)
    })
    .onUpdate((event) => {
      pinchScale.value = event.scale
      applyTwoFingers()
    })
    .onFinalize(() => {
      if (!pinching.value) return
      pinching.value = false
      endTwoFingers()
    })
  const twoFingerPan = Gesture.Pan()
    .minPointers(2)
    .onStart((event) => {
      twoFingerPanning.value = true
      beginTwoFingers(event.x, event.y)
    })
    .onUpdate((event) => {
      panX.value = event.translationX
      panY.value = event.translationY
      applyTwoFingers()
    })
    .onFinalize(() => {
      if (!twoFingerPanning.value) return
      twoFingerPanning.value = false
      endTwoFingers()
    })

  // One finger: while watching it moves the zoomed picture; while in control it scrolls the page
  // under it, as a finger does on a phone, along whichever direction it set off in.
  const dragStartX = useSharedValue(0)
  const dragStartY = useSharedValue(0)
  const sentNotches = useSharedValue(0)
  const dragAxis = useSharedValue(0)
  const oneFingerPan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(10)
    .onStart((event) => {
      dragStartX.value = held ? event.x - event.translationX : offsetX.value
      dragStartY.value = held ? event.y - event.translationY : offsetY.value
      sentNotches.value = 0
      dragAxis.value = 0
    })
    .onUpdate((event) => {
      const viewportSize = { width: viewportWidth.value, height: viewportHeight.value }
      if (!held) {
        const next = clampTransform(
          { scale: scale.value, x: dragStartX.value + event.translationX, y: dragStartY.value + event.translationY },
          viewportSize,
          fittedSize(viewportSize, screen),
        )
        offsetX.value = next.x
        offsetY.value = next.y
        return
      }
      if (dragAxis.value === 0) dragAxis.value = Math.abs(event.translationY) >= Math.abs(event.translationX) ? 2 : 1
      const vertical = dragAxis.value === 2
      const notches = scrollNotches(
        vertical ? event.translationY : event.translationX,
        sentNotches.value,
        { scale: scale.value, x: offsetX.value, y: offsetY.value },
        viewportSize,
        screen,
      )
      if (notches === 0) return
      sentNotches.value += notches
      runOnJS(scrollAt)(dragStartX.value, dragStartY.value, vertical ? 0 : notches, vertical ? notches : 0)
    })

  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((event, success) => { if (success) runOnJS(clickAt)(event.x, event.y, 'left') })
  const longPress = Gesture.LongPress()
    .minDuration(450)
    .maxDistance(10)
    .onStart((event) => runOnJS(clickAt)(event.x, event.y, 'right'))
  const zoomTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event, success) => {
      if (!success) return
      const viewportSize = { width: viewportWidth.value, height: viewportHeight.value }
      const current = { scale: scale.value, x: offsetX.value, y: offsetY.value }
      const target = current.scale > 1.01 ? 1 : DOUBLE_TAP_ZOOM
      const point = { x: event.x, y: event.y }
      const next = pinchTransform(current, point, point, target / current.scale, viewportSize, fittedSize(viewportSize, screen))
      scale.value = withTiming(next.scale, { duration: 180 })
      offsetX.value = withTiming(next.x, { duration: 180 })
      offsetY.value = withTiming(next.y, { duration: 180 })
    })
  const viewGestures = Gesture.Simultaneous(pinch, twoFingerPan)
  const gesture = held
    // A second finger turns a touch into moving the view, so a pinch never clicks or scrolls.
    ? Gesture.Race(viewGestures, Gesture.Race(oneFingerPan, Gesture.Exclusive(longPress, tap)))
    : Gesture.Simultaneous(viewGestures, oneFingerPan, zoomTap)

  const toggleControl = async () => {
    if (held) {
      control.release()
      setNotice(null)
      return
    }
    setTaking(true)
    setNotice(null)
    try {
      const result = await control.take()
      if (result === 'refused') setNotice(CONTROL_REFUSED_TEXT)
    } catch (error) {
      setNotice(error instanceof Error && error.message ? error.message : CONTROL_REFUSED_TEXT)
    } finally {
      setTaking(false)
    }
  }
  const sendText = () => {
    if (!text) return
    for (const event of textEvents(text)) send(event)
    setText('')
  }

  const status = held ? "You're in control" : 'Watching'
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityLabel="The workspace's screen"
          accessibilityRole="image"
          collapsable={false}
          onLayout={onLayout}
          style={[styles.viewport, { backgroundColor: theme.isDark ? '#000000' : theme.elevated2 }]}
        >
          {fitted.width > 0 ? (
            <Reanimated.View style={[{
              position: 'absolute',
              left: (viewport.width - fitted.width) / 2,
              top: (viewport.height - fitted.height) / 2,
              width: fitted.width,
              height: fitted.height,
            }, pictureStyle]}>
              {[layers.front, layers.next].map((uri) => uri ? (
                <Image
                  accessible={false}
                  cachePolicy="none"
                  contentFit="fill"
                  key={uri}
                  onError={() => dropNext(uri)}
                  onLoad={() => promote(uri)}
                  source={{ uri }}
                  style={[StyleSheet.absoluteFill, uri !== layers.front && styles.hidden]}
                  transition={0}
                />
              ) : null)}
            </Reanimated.View>
          ) : null}
          {!layers.front ? <View style={styles.loadingOverlay}><ActivityIndicator accessibilityLabel="Loading the screen" color={theme.secondary} /></View> : null}
        </View>
      </GestureDetector>
      <View style={[styles.controls, { borderTopColor: theme.separator }]}>
        <View style={styles.statusRow}>
          <View style={styles.statusCopy}>
            <View style={styles.statusLine}>
              <View style={[styles.statusDot, { backgroundColor: held ? theme.green : theme.secondary }]} />
              <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.statusText, { color: theme.text }]}>{status}</Text>
              {!connected ? <Text numberOfLines={1} style={[styles.statusDetail, { color: theme.secondary }]}>Reconnecting…</Text> : null}
            </View>
            {held ? <Text style={[styles.hint, { color: theme.secondary }]}>Tap to click, hold to right-click, drag to scroll. Use two fingers to zoom and move around.</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: taking }}
            disabled={taking}
            onPress={() => { void toggleControl() }}
            style={({ pressed }) => [styles.button, styles.controlButton, { backgroundColor: theme.fillStrong }, (pressed || taking) && styles.pressed]}
          >
            <Text style={[styles.buttonText, { color: theme.text }]}>{held ? 'Hand back' : 'Take control'}</Text>
          </Pressable>
        </View>
        {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: theme.orange }]}>{notice}</Text> : null}
        {held ? (
          <>
            <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys}>
              {KEYS.map((key) => (
                <Pressable
                  accessibilityLabel={key.accessibilityLabel}
                  accessibilityRole="button"
                  key={key.keys}
                  onPress={() => send({ type: 'key', keys: key.keys })}
                  style={({ pressed }) => [styles.key, { backgroundColor: theme.fill, borderColor: theme.separator }, pressed && styles.pressed]}
                >
                  <Text style={[styles.keyText, { color: theme.text }]}>{key.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[styles.typeRow, { backgroundColor: theme.fill, borderColor: theme.separator }]}>
              {/* Often a password: nothing here is corrected, suggested, saved or logged. */}
              <TextInput
                accessibilityLabel="Text to type on the screen"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                importantForAutofill="no"
                keyboardType={Platform.OS === 'android' && !hideText ? 'visible-password' : 'default'}
                onChangeText={setText}
                onSubmitEditing={sendText}
                placeholder="Type on the screen"
                placeholderTextColor={theme.tertiary}
                returnKeyType="send"
                secureTextEntry={hideText}
                spellCheck={false}
                style={[styles.typeInput, { color: theme.text }]}
                submitBehavior="submit"
                textContentType="none"
                value={text}
              />
              <Pressable
                accessibilityLabel={hideText ? 'Show what you type' : 'Hide what you type'}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => setHideText((value) => !value)}
                style={({ pressed }) => [styles.typeButton, pressed && styles.pressed]}
              >
                {hideText ? <EyeOff color={theme.secondary} size={18} /> : <Eye color={theme.secondary} size={18} />}
              </Pressable>
              <Pressable
                accessibilityLabel="Type it"
                accessibilityRole="button"
                accessibilityState={{ disabled: !text }}
                disabled={!text}
                hitSlop={6}
                onPress={sendText}
                style={({ pressed }) => [styles.typeButton, (pressed || !text) && styles.pressed]}
              >
                <SendHorizontal color={text ? theme.blue : theme.tertiary} size={18} />
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { width: 80 },
  headerTrailing: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 17, fontWeight: '600' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  messageText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  viewport: { flex: 1, overflow: 'hidden' },
  hidden: { opacity: 0 },
  loadingOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusCopy: { flex: 1, minWidth: 0, gap: 3 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  statusDetail: { flexShrink: 1, fontSize: 13 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  notice: { fontSize: 13, lineHeight: 18 },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingHorizontal: 18 },
  controlButton: { minWidth: 128 },
  retryButton: { minWidth: 160 },
  buttonText: { fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  keys: { gap: 8 },
  key: { minWidth: 44, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  keyText: { fontSize: 14, fontWeight: '600' },
  typeRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 14, paddingRight: 6, gap: 4 },
  typeInput: { flex: 1, minHeight: 44, fontSize: 15, paddingVertical: 10 },
  typeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
})
