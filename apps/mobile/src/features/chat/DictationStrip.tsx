import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, type ColorValue, type LayoutChangeEvent } from 'react-native'
import Reanimated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { DICTATION_WAVEFORM_SAMPLES, dictationNearsLimit, dictationWaveformBarCount, formatDictationElapsed } from '@pulpo/client-core'
import type { DictationLevelSource, DictationState } from './dictation'
import { DICTATION_WAVEFORM_HEIGHT, dictationStatusLabel, dictationStripEntering, dictationStripExiting } from './dictationMotion'

const MIN_BAR_HEIGHT = 2
const LEVEL_TIMING = { duration: 100, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System } as const
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
  const animatedStyle = useAnimatedStyle(() => {
    const level = levels.value[index] ?? 0
    return {
      opacity: withTiming(0.22 + level * 0.78, LEVEL_TIMING),
      transform: [{
        scaleY: withTiming((MIN_BAR_HEIGHT + level * (DICTATION_WAVEFORM_HEIGHT - MIN_BAR_HEIGHT)) / DICTATION_WAVEFORM_HEIGHT, LEVEL_TIMING),
      }],
    }
  })
  return <Reanimated.View style={[styles.bar, { backgroundColor: color }, animatedStyle]} />
})

/** Scrolling loudness history: the newest sample enters on the right. */
export const DictationWaveform = memo(function DictationWaveform({ source, color }: { source: DictationLevelSource; color: ColorValue }) {
  const levels = useLevelHistory(source)
  const [barCount, setBarCount] = useState(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setBarCount(dictationWaveformBarCount(event.nativeEvent.layout.width))
  }, [])
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveform} onLayout={onLayout}>
      {Array.from({ length: barCount }, (_, index) => (
        <WaveformBar key={index} levels={levels} index={DICTATION_WAVEFORM_SAMPLES - barCount + index} color={color} />
      ))}
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
  strip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  status: { flex: 1, minWidth: 0, height: 44, justifyContent: 'center' },
  statusLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  labelLayer: { justifyContent: 'center', paddingHorizontal: 8 },
  waveform: { flex: 1, minWidth: 0, height: DICTATION_WAVEFORM_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  bar: { width: 2, height: DICTATION_WAVEFORM_HEIGHT, borderRadius: 1 },
  elapsed: { fontSize: 13, fontVariant: ['tabular-nums'] },
  label: { fontSize: 14, textAlign: 'center' },
})
