import { formatRecordingTime, RECORDING_SEEK_MS, waveformBars, type RecordingTimeline } from '@pulpo/client-core/files'
import type { RecordingRange } from '@pulpo/contracts'
import { memo, useMemo, useRef, useState } from 'react'
import { StyleSheet, View, type ColorValue } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useAppTheme } from '../../../theme'

const BAR_WIDTH = 2
const BAR_PITCH = 3
const HEIGHT = 64
const MIN_BAR = 2
/** Selections shorter than this are taken as a seek instead. */
const MIN_SELECTION_MS = 300

const Bars = memo(function Bars({ bars, color, width }: { bars: number[]; color: ColorValue; width: number }) {
  return (
    <View style={[styles.bars, { width }]}>
      {bars.map((level, index) => (
        <View key={index} style={[styles.bar, { backgroundColor: color, height: Math.max(MIN_BAR, level * (HEIGHT - 8)) }]} />
      ))}
    </View>
  )
})

interface Props {
  timeline: RecordingTimeline
  positionMs: number
  selection: RecordingRange | null
  /** Where a skip being marked during playback starts. */
  markStartMs: number | null
  /** Whether parts can be selected (to skip them); otherwise dragging only scrubs. */
  selectable: boolean
  onSeek: (ms: number) => void
  onSeekBy: (deltaMs: number) => void
  onSelect: (range: RecordingRange | null) => void
}

/**
 * The whole recording's waveform: takes laid end to end (with a line between them), skipped parts
 * dimmed, and the playhead. Tap to seek and drag to scrub; touch and hold, then drag, to select a
 * part (to skip it, or keep it).
 */
export function RecordingTimelineView({ timeline, positionMs, selection, markStartMs, selectable, onSeek, onSeekBy, onSelect }: Props) {
  const theme = useAppTheme()
  const [width, setWidth] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const [selecting, setSelecting] = useState<RecordingRange | null>(null)
  const latest = useRef({ timeline, width, onSeek, onSelect })
  latest.current = { timeline, width, onSeek, onSelect }
  const count = Math.max(0, Math.floor(width / BAR_PITCH))
  const bars = useMemo(() => waveformBars(timeline, count), [count, timeline])
  const { durationMs } = timeline

  const gesture = useMemo(() => {
    const at = (x: number) => {
      const current = latest.current
      if (!current.width || !current.timeline.durationMs) return 0
      return Math.round(Math.min(1, Math.max(0, x / current.width)) * current.timeline.durationMs)
    }
    const tap = Gesture.Tap().runOnJS(true).onEnd((event, success) => { if (success) latest.current.onSeek(at(event.x)) })
    const scrubbing = Gesture.Pan().runOnJS(true).activeOffsetX([-6, 6])
      .onStart((event) => setScrub(at(event.x)))
      .onUpdate((event) => setScrub(at(event.x)))
      .onEnd((event) => latest.current.onSeek(at(event.x)))
      .onFinalize(() => setScrub(null))
    if (!selectable) return Gesture.Exclusive(scrubbing, tap)
    let anchor = 0
    const select = Gesture.Pan().runOnJS(true).activateAfterLongPress(300)
      .onStart((event) => {
        anchor = at(event.x)
        setSelecting({ startMs: anchor, endMs: anchor })
      })
      .onUpdate((event) => {
        const here = at(event.x)
        setSelecting({ startMs: Math.min(anchor, here), endMs: Math.max(anchor, here) })
      })
      .onEnd((event) => {
        const here = at(event.x)
        const range = { startMs: Math.min(anchor, here), endMs: Math.max(anchor, here) }
        if (range.endMs - range.startMs >= MIN_SELECTION_MS) latest.current.onSelect(range)
        else latest.current.onSeek(here)
      })
      .onFinalize(() => setSelecting(null))
    return Gesture.Exclusive(select, scrubbing, tap)
  }, [selectable])

  const x = (ms: number) => durationMs ? (Math.min(Math.max(ms, 0), durationMs) / durationMs) * width : 0
  const shown = scrub ?? positionMs
  const range = selecting ?? selection
  const dim = theme.isDark ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.7)'
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Recording position"
        accessibilityHint={selectable ? 'Touch and hold, then drag, to select a part to skip.' : undefined}
        accessibilityValue={{ text: `${formatRecordingTime(shown)} of ${formatRecordingTime(durationMs)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent }) => onSeekBy(nativeEvent.actionName === 'increment' ? RECORDING_SEEK_MS : -RECORDING_SEEK_MS)}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={styles.track}
        testID="recording-timeline"
      >
        <Bars bars={bars} color={theme.tertiary} width={width} />
        <View pointerEvents="none" style={[styles.played, { width: x(shown) }]}>
          <Bars bars={bars} color={theme.text} width={width} />
        </View>
        {timeline.skips.map((skip) => (
          <View
            key={`${skip.startMs}-${skip.endMs}`}
            pointerEvents="none"
            style={[styles.skip, { left: x(skip.startMs), width: Math.max(1, x(skip.endMs) - x(skip.startMs)), backgroundColor: dim, borderBottomColor: theme.orange }]}
          />
        ))}
        {timeline.clips.slice(1).map((entry) => (
          <View key={entry.clip.id} pointerEvents="none" style={[styles.boundary, { left: x(entry.startMs), backgroundColor: theme.secondary }]} />
        ))}
        {range ? (
          <View pointerEvents="none" style={[styles.selection, { left: x(range.startMs), width: Math.max(2, x(range.endMs) - x(range.startMs)), borderColor: theme.blue, backgroundColor: theme.isDark ? 'rgba(101,167,255,0.22)' : 'rgba(7,95,190,0.14)' }]} />
        ) : null}
        {markStartMs !== null ? <View pointerEvents="none" style={[styles.mark, { left: x(markStartMs) - 1, backgroundColor: theme.orange }]} /> : null}
        <View pointerEvents="none" style={[styles.playhead, { left: x(shown) - 1, backgroundColor: theme.red }]}>
          <View style={[styles.playheadKnob, { backgroundColor: theme.red }]} />
        </View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  track: { height: HEIGHT, justifyContent: 'center' },
  bars: { height: HEIGHT, flexDirection: 'row', alignItems: 'center', gap: BAR_PITCH - BAR_WIDTH },
  bar: { width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2 },
  played: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  skip: { position: 'absolute', top: 0, bottom: 0, borderBottomWidth: 3 },
  boundary: { position: 'absolute', top: 6, bottom: 6, width: StyleSheet.hairlineWidth * 2, opacity: 0.6 },
  selection: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 2, borderRightWidth: 2 },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  playhead: { position: 'absolute', top: -2, bottom: 0, width: 2, alignItems: 'center' },
  playheadKnob: { width: 8, height: 8, borderRadius: 4, marginTop: -3 },
})
