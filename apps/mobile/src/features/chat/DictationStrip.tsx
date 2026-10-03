import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type ColorValue, type LayoutChangeEvent } from 'react-native'
import Reanimated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import {
  DICTATION_LEVEL_INTERVAL_MS,
  DICTATION_WAVEFORM_BAR_PITCH,
  DICTATION_WAVEFORM_BAR_WIDTH,
  DICTATION_WAVEFORM_SAMPLES,
  dictationNearsLimit,
  dictationWaveformBarCount,
  formatDictationElapsed,
} from '@pulpo/client-core'
import { SymbolView } from '../../platform/SymbolView'
import type { DictationLevelSource, DictationState } from './dictation'
import { DICTATION_WAVEFORM_HEIGHT, dictationStatusLabel, dictationStripEntering, dictationStripExiting } from './dictationMotion'

const MIN_BAR_HEIGHT = 2
/** One sampling interval, linear, so consecutive slides join into continuous motion. */
const SCROLL_TIMING = { duration: DICTATION_LEVEL_INTERVAL_MS, easing: Easing.linear, reduceMotion: ReduceMotion.System } as const
const STATUS_TIMING = { duration: 220, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System } as const

export type DictationStripColors = { text: ColorValue; muted: ColorValue; warning: ColorValue }

/** Mirrors the controller's level history into a shared value so bars animate without React renders. */
function useLevelHistory(source: DictationLevelSource): SharedValue<readonly number[]> {
  const levels = useSharedValue(source.getLevels())
  useEffect(() => {
    levels.value = source.getLevels()
    return source.subscribeLevels(() => { levels.value = source.getLevels() })
  }, [levels, source])
  return levels
}

const WaveformBar = memo(function WaveformBar({ levels, index, color }: {
  levels: SharedValue<readonly number[]>
  index: number
  color: ColorValue
}) {
  // Each bar keeps its sample's height as it travels; the row's slide supplies the motion.
  const animatedStyle = useAnimatedStyle(() => {
    const level = levels.value[index] ?? 0
    return {
      opacity: 0.22 + level * 0.78,
      transform: [{ scaleY: (MIN_BAR_HEIGHT + level * (DICTATION_WAVEFORM_HEIGHT - MIN_BAR_HEIGHT)) / DICTATION_WAVEFORM_HEIGHT }],
    }
  })
  return <Reanimated.View style={[styles.bar, { backgroundColor: color }, animatedStyle]} />
})

/** Scrolling loudness history: bars glide left and the newest sample slides in from the right. */
export const DictationWaveform = memo(function DictationWaveform({ source, color }: { source: DictationLevelSource; color: ColorValue }) {
  const levels = useLevelHistory(source)
  const offset = useSharedValue(0)
  // A new sample moves every bar one slot left. Starting the row one pitch to the right and
  // sliding it back over one interval turns those steps into a smooth scroll.
  useAnimatedReaction(() => levels.value, (current, previous) => {
    if (previous === null || current === previous) return
    offset.value = withSequence(
      withTiming(DICTATION_WAVEFORM_BAR_PITCH, { duration: 0, reduceMotion: ReduceMotion.System }),
      withTiming(0, SCROLL_TIMING),
    )
  })
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }))
  const [barCount, setBarCount] = useState(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setBarCount(dictationWaveformBarCount(event.nativeEvent.layout.width))
  }, [])
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveform} onLayout={onLayout}>
      <Reanimated.View style={[styles.waveformRow, rowStyle]}>
        {Array.from({ length: barCount }, (_, index) => (
          <WaveformBar key={index} levels={levels} index={DICTATION_WAVEFORM_SAMPLES - barCount + index} color={color} />
        ))}
      </Reanimated.View>
    </View>
  )
})

/** Waveform and timer while recording; cross-fades to a text status while preparing or transcribing. */
export function DictationStatus({ phase, seconds, source, colors }: {
  phase: DictationState['phase']
  seconds: number
  source: DictationLevelSource
  colors: DictationStripColors
}) {
  const recording = phase === 'recording'
  const visibility = useSharedValue(recording ? 1 : 0)
  useEffect(() => {
    visibility.value = withTiming(recording ? 1 : 0, STATUS_TIMING)
  }, [recording, visibility])
  const waveformStyle = useAnimatedStyle(() => ({ opacity: visibility.value }))
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - visibility.value }))
  const label = dictationStatusLabel(phase, seconds)
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion={recording ? 'none' : 'polite'}
      style={styles.status}
    >
      <Reanimated.View style={[styles.statusLayer, styles.recordingRow, waveformStyle]}>
        <DictationWaveform source={source} color={colors.text} />
        <Text
          maxFontSizeMultiplier={1.4}
          numberOfLines={1}
          style={[styles.elapsed, { color: dictationNearsLimit(seconds) ? colors.warning : colors.muted }]}
        >
          {formatDictationElapsed(seconds)}
        </Text>
      </Reanimated.View>
      <Reanimated.View style={[styles.statusLayer, styles.labelLayer, labelStyle]}>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[styles.label, { color: colors.muted }]}>{label}</Text>
      </Reanimated.View>
    </View>
  )
}

/**
 * Plain icon cancel button laid out by React Native, so it centres on the waveform exactly.
 * A SwiftUI glass button here rendered several points above the strip's centre line.
 */
export function DictationCancelButton({ onPress, disabled = false, color }: { onPress: () => void; disabled?: boolean; color: ColorValue }) {
  return (
    <Pressable
      accessibilityLabel="Cancel dictation"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.cancel, disabled ? styles.cancelDisabled : pressed && styles.cancelPressed]}
    >
      <SymbolView name="xmark" size={18} weight="medium" tintColor={color} />
    </Pressable>
  )
}

/** Replaces the composer toolbar while dictating: cancel, live status, and finish. */
export function DictationStrip({ leading, trailing, ...status }: {
  phase: DictationState['phase']
  seconds: number
  source: DictationLevelSource
  colors: DictationStripColors
  leading: ReactNode
  trailing: ReactNode
}) {
  return (
    <Reanimated.View entering={dictationStripEntering} exiting={dictationStripExiting} style={styles.strip}>
      {leading}
      <DictationStatus {...status} />
      {trailing}
    </Reanimated.View>
  )
}

const styles = StyleSheet.create({
  cancel: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelPressed: { opacity: 0.5 },
  cancelDisabled: { opacity: 0.4 },
  strip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  status: { flex: 1, minWidth: 0, height: 44, justifyContent: 'center' },
  statusLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  labelLayer: { justifyContent: 'center', paddingHorizontal: 8 },
  waveform: { flex: 1, minWidth: 0, height: DICTATION_WAVEFORM_HEIGHT, overflow: 'hidden' },
  // Right-aligned and wider than the track, so the oldest bar hides past the left edge.
  waveformRow: { position: 'absolute', top: 0, bottom: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: DICTATION_WAVEFORM_BAR_PITCH - DICTATION_WAVEFORM_BAR_WIDTH },
  bar: { width: DICTATION_WAVEFORM_BAR_WIDTH, height: DICTATION_WAVEFORM_HEIGHT, borderRadius: DICTATION_WAVEFORM_BAR_WIDTH / 2 },
  elapsed: { fontSize: 13, fontVariant: ['tabular-nums'] },
  label: { fontSize: 14, textAlign: 'center' },
})
