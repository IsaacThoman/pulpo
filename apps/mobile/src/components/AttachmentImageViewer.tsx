import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import {
  Button as SwiftUIButton,
  Host as SwiftUIHost,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers'
import { StatusBar } from 'expo-status-bar'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { RefreshCw } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassIconButton } from './GlassIconButton'

export interface AttachmentImagePreviewItem {
  id: string
  name: string
  uri?: string
}

interface AttachmentImageViewerProps {
  initialIndex: number
  items: AttachmentImagePreviewItem[]
  onClose: () => void
  onShare: (item: AttachmentImagePreviewItem) => void
  reduceMotion?: boolean
  reduceTransparency?: boolean
  resolveUri: (item: AttachmentImagePreviewItem) => Promise<string>
  visible: boolean
}

function GalleryMetadata({ count, name, onPress, reduceTransparency }: {
  count?: string
  name: string
  onPress: () => void
  reduceTransparency: boolean
}) {
  const label = `${name}${count ? `, ${count}` : ''}. Hide preview controls`
  const controlMaxWidth = Platform.OS === 'ios' && Platform.isPad ? 360 : 230
  const textMaxWidth = controlMaxWidth - 32
  if (Platform.OS === 'ios' && !reduceTransparency) {
    return (
      <View style={styles.metadataSlot}>
        <SwiftUIHost colorScheme="dark" matchContents style={[styles.metadataNativeHost, { maxWidth: controlMaxWidth }]}>
          <SwiftUIButton
            onPress={onPress}
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('capsule'),
              controlSize('regular'),
              frame({ minHeight: 44 }),
              accessibilityLabel(label),
            ]}
          >
            <SwiftUIVStack alignment="center" spacing={1}>
              <SwiftUIText modifiers={[
                font({ textStyle: 'subheadline', weight: 'semibold' }),
                frame({ maxWidth: textMaxWidth }),
                lineLimit(1),
                truncationMode('middle'),
              ]}>{name}</SwiftUIText>
              {count ? <SwiftUIText modifiers={[font({ textStyle: 'caption2' }), foregroundStyle('secondary'), lineLimit(1)]}>{count}</SwiftUIText> : null}
            </SwiftUIVStack>
          </SwiftUIButton>
        </SwiftUIHost>
      </View>
    )
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.metadataGlass, styles.metadataFallback, pressed && styles.metadataPressed]}
    >
      <View pointerEvents="none" style={styles.titleBlock}>
        <Text numberOfLines={1} style={styles.title}>{name}</Text>
        {count ? <Text style={styles.count}>{count}</Text> : null}
      </View>
    </Pressable>
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  'worklet'
  return Math.min(maximum, Math.max(minimum, value))
}

function ZoomableImage({
  height,
  item,
  onChromeToggle,
  onDismiss,
  onZoomChange,
  reduceMotion,
  resolveUri,
  width,
}: {
  height: number
  item: AttachmentImagePreviewItem
  onChromeToggle: () => void
  onDismiss: () => void
  onZoomChange: (zoomed: boolean) => void
  reduceMotion: boolean
  resolveUri: (item: AttachmentImagePreviewItem) => Promise<string>
  width: number
}) {
  const [uri, setUri] = useState(item.uri ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryRevision, setRetryRevision] = useState(0)
  const [zoomMode, setZoomMode] = useState(false)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const fittedWidth = useSharedValue(width)
  const fittedHeight = useSharedValue(height)

  useEffect(() => {
    let cancelled = false
    setUri(item.uri ?? '')
    setLoading(true)
    setError(null)
    if (item.uri) return () => { cancelled = true }
    void resolveUri(item).then((resolved) => {
      if (!cancelled) setUri(resolved)
    }).catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : 'The full-resolution image could not be loaded.')
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [item, resolveUri, retryRevision])

  useEffect(() => {
    scale.value = 1
    savedScale.value = 1
    translateX.value = 0
    translateY.value = 0
    savedX.value = 0
    savedY.value = 0
    setZoomMode(false)
    onZoomChange(false)
  }, [item.id, onZoomChange, savedScale, savedX, savedY, scale, translateX, translateY])

  const updateZoomMode = useCallback((nextZoomMode: boolean) => {
    setZoomMode(nextZoomMode)
    onZoomChange(nextZoomMode)
  }, [onZoomChange])

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }))

  const pinch = Gesture.Pinch()
    .onBegin(() => { savedScale.value = scale.value })
    .onUpdate((event) => { scale.value = clamp(savedScale.value * event.scale, 1, 4) })
    .onEnd(() => {
      if (scale.value < 1.04) {
        scale.value = withTiming(1)
        translateX.value = withTiming(0)
        translateY.value = withTiming(0)
        runOnJS(updateZoomMode)(false)
      } else {
        savedScale.value = scale.value
        runOnJS(updateZoomMode)(true)
      }
    })

  const zoomPan = Gesture.Pan()
    .enabled(zoomMode)
    .minDistance(5)
    .onBegin(() => {
      savedX.value = translateX.value
      savedY.value = translateY.value
    })
    .onUpdate((event) => {
      const maxX = Math.max(0, (fittedWidth.value * scale.value - width) / 2)
      const maxY = Math.max(0, (fittedHeight.value * scale.value - height) / 2)
      translateX.value = clamp(savedX.value + event.translationX, -maxX, maxX)
      translateY.value = clamp(savedY.value + event.translationY, -maxY, maxY)
    })
    .onEnd(() => {
      savedX.value = translateX.value
      savedY.value = translateY.value
    })

  const dismissPan = Gesture.Pan()
    .enabled(!zoomMode)
    .maxPointers(1)
    .activeOffsetY([-12, 12])
    .failOffsetX([-18, 18])
    .onUpdate((event) => {
      translateY.value = event.translationY
    })
    .onEnd((event) => {
      if (Math.abs(event.translationY) > 110 || Math.abs(event.velocityY) > 900) {
        runOnJS(onDismiss)()
        return
      }
      translateY.value = reduceMotion ? 0 : withSpring(0, { damping: 18, stiffness: 220 })
    })

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    const zooming = scale.value <= 1.01
    const target = zooming ? 2.5 : 1
    scale.value = reduceMotion ? target : withTiming(target, { duration: 180 })
    if (!zooming) {
      translateX.value = reduceMotion ? 0 : withTiming(0, { duration: 180 })
      translateY.value = reduceMotion ? 0 : withTiming(0, { duration: 180 })
    }
    savedScale.value = target
    savedX.value = 0
    savedY.value = 0
    runOnJS(updateZoomMode)(zooming)
  })
  const singleTap = Gesture.Tap().numberOfTaps(1).onEnd(() => runOnJS(onChromeToggle)())
  const taps = Gesture.Exclusive(doubleTap, singleTap)
  const gestures = Gesture.Simultaneous(pinch, zoomPan, dismissPan, taps)

  return (
    <GestureDetector gesture={gestures}>
      <View accessibilityLabel={`Fullscreen preview of ${item.name}`} style={{ width, height }}>
        {uri ? (
          <Reanimated.View style={[styles.imageCanvas, imageStyle]}>
            <Image
              accessibilityIgnoresInvertColors
              onError={() => {
                setError('The full-resolution image could not be loaded.')
                setLoading(false)
                setUri('')
              }}
              onLoad={(event) => {
                const sourceWidth = event.nativeEvent.source.width
                const sourceHeight = event.nativeEvent.source.height
                const sourceRatio = sourceWidth / Math.max(1, sourceHeight)
                const canvasRatio = width / Math.max(1, height)
                if (sourceRatio > canvasRatio) {
                  fittedWidth.value = width
                  fittedHeight.value = width / sourceRatio
                } else {
                  fittedHeight.value = height
                  fittedWidth.value = height * sourceRatio
                }
                setLoading(false)
              }}
              source={{ uri }}
              resizeMode="contain"
              style={styles.fullImage}
            />
            {loading ? <View style={styles.imageLoadingOverlay}><ActivityIndicator color="#ffffff" size="large" /></View> : null}
          </Reanimated.View>
        ) : (
          <View style={styles.imageState}>
            {loading ? <ActivityIndicator color="#ffffff" size="large" /> : (
              <>
                <Text style={styles.imageErrorTitle}>Image unavailable</Text>
                <Text style={styles.imageErrorText}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={() => setRetryRevision((value) => value + 1)} style={styles.retryButton}>
                  <RefreshCw color="#ffffff" size={16} />
                  <Text style={styles.retryText}>Try Again</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>
    </GestureDetector>
  )
}

export function AttachmentImageViewer({
  initialIndex,
  items,
  onClose,
  onShare,
  reduceMotion = false,
  reduceTransparency = false,
  resolveUri,
  visible,
}: AttachmentImageViewerProps) {
  const { height, width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(initialIndex)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [zoomed, setZoomed] = useState(false)
  const listRef = useRef<FlatList<AttachmentImagePreviewItem>>(null)
  const chromeProgress = useSharedValue(1)

  useEffect(() => {
    if (!visible) return
    setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)))
    setChromeVisible(true)
    setZoomed(false)
  }, [initialIndex, items.length, visible])

  useEffect(() => {
    if (!visible) return
    const targetIndex = Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1))
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ animated: false, offset: width * targetIndex })
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [height, initialIndex, items.length, visible, width])

  useEffect(() => {
    const target = chromeVisible ? 1 : 0
    chromeProgress.value = reduceMotion ? target : withTiming(target, { duration: 180 })
  }, [chromeProgress, chromeVisible, reduceMotion])

  const current = items[index]
  const getItemLayout = useCallback((_: ArrayLike<AttachmentImagePreviewItem> | null | undefined, itemIndex: number) => ({
    index: itemIndex,
    length: width,
    offset: width * itemIndex,
  }), [width])
  const handleScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width))
    setIndex(Math.min(Math.max(0, next), Math.max(0, items.length - 1)))
  }, [items.length, width])
  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    listRef.current?.scrollToOffset({
      animated: false,
      offset: event.nativeEvent.layout.width * index,
    })
  }, [index])
  const renderItem = useCallback(({ item }: { item: AttachmentImagePreviewItem }) => (
    <ZoomableImage
      height={height}
      item={item}
      onChromeToggle={() => setChromeVisible((value) => !value)}
      onDismiss={onClose}
      onZoomChange={setZoomed}
      reduceMotion={reduceMotion}
      resolveUri={resolveUri}
      width={width}
    />
  ), [height, onClose, reduceMotion, resolveUri, width])
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: chromeProgress.value,
    transform: [{ translateY: interpolate(chromeProgress.value, [0, 1], [-8, 0]) }],
  }))
  const chromeTop = Math.max(insets.top, 16)

  if (!items.length) return null
  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      supportedOrientations={Platform.OS === 'ios' && Platform.isPad
        ? ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']
        : ['portrait']}
      visible={visible}
    >
      <View accessibilityViewIsModal style={styles.root}>
        <StatusBar hidden style="light" />
        <FlatList
          key={`${Math.round(width)}x${Math.round(height)}`}
          data={items}
          decelerationRate="fast"
          getItemLayout={getItemLayout}
          horizontal
          initialNumToRender={items.length}
          keyExtractor={(item) => item.id}
          onLayout={handleListLayout}
          onMomentumScrollEnd={handleScrollEnd}
          pagingEnabled
          renderItem={renderItem}
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          windowSize={3}
          ref={listRef}
        />
        <Reanimated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[styles.chrome, { paddingTop: chromeTop }, chromeStyle]}
        >
          <View style={styles.topBar}>
            <GlassIconButton colorScheme="dark" icon="xmark" label="Close image preview" onPress={onClose} />
            <GalleryMetadata
              count={items.length > 1 ? `${index + 1} of ${items.length}` : undefined}
              name={current?.name ?? 'Image'}
              onPress={() => setChromeVisible(false)}
              reduceTransparency={reduceTransparency}
            />
            <GlassIconButton
              colorScheme="dark"
              icon="square.and.arrow.up"
              label={`Share ${current?.name ?? 'image'}`}
              onPress={() => current && onShare(current)}
            />
          </View>
        </Reanimated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  imageCanvas: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullImage: { width: '100%', height: '100%' },
  imageState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  imageLoadingOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
  imageErrorTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  imageErrorText: { color: 'rgba(255,255,255,0.62)', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  retryButton: { minHeight: 44, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 22, paddingHorizontal: 18, backgroundColor: 'rgba(255,255,255,0.16)' },
  retryText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  chrome: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-start' },
  topBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16 },
  metadataSlot: { minWidth: 0, flex: 1, alignItems: 'center', justifyContent: 'center' },
  metadataNativeHost: { minHeight: 44, justifyContent: 'center' },
  metadataGlass: { minWidth: 0, maxWidth: 520, minHeight: 44, flex: 1, borderRadius: 22, overflow: 'hidden' },
  metadataFallback: { backgroundColor: 'rgba(44,44,46,0.86)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  metadataPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  titleBlock: { minWidth: 0, minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 5 },
  title: { maxWidth: '100%', color: '#ffffff', fontSize: 14, fontWeight: '600' },
  count: { marginTop: 2, color: 'rgba(255,255,255,0.62)', fontSize: 11, fontVariant: ['tabular-nums'] },
})
