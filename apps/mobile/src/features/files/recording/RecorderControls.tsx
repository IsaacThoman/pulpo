import { formatRecordingTime } from '@pulpo/client-core/files'
import { RECORDING_TAKE_MAX_SECONDS } from '@pulpo/contracts'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { DictationWaveform } from '../../chat/DictationStrip'
import type { DictationLevelSource } from '../../chat/dictation'
import type { TakeRecorderState } from './recorder'

const RECORD_RED = '#FF3B30'

/** The big red button that records a new take at the end of the recording. */
export function RecordButton({ busy, disabled, hasTakes, onPress }: { busy: boolean; disabled?: boolean; hasTakes: boolean; onPress: () => void }) {
  const theme = useAppTheme()
  return (
    <Pressable
      accessibilityLabel={hasTakes ? 'Record a new take' : 'Record'}
      accessibilityHint={hasTakes ? 'Adds a take at the end of the recording.' : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.recordRing, { borderColor: theme.isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.18)', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
      testID="recording-record"
    >
      <View style={[styles.recordDot, { backgroundColor: RECORD_RED }]}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  )
}

function RoundButton({ label, symbol, onPress, prominent, testID }: { label: string; symbol: string; onPress: () => void; prominent?: boolean; testID?: string }) {
  const theme = useAppTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [prominent ? styles.roundLarge : styles.round, { backgroundColor: theme.fillStrong, opacity: pressed ? 0.6 : 1 }]}
      testID={testID}
    >
      <SymbolView name={symbol as never} size={prominent ? 24 : 18} tintColor={theme.text} weight="semibold" />
    </Pressable>
  )
}

/**
 * Shown while a take is open: the live waveform and time, and pause or resume, discard, and stop
 * (which saves the take).
 */
export function RecorderPanel({ state, source, onPause, onResume, onStop, onCancel }: {
  state: TakeRecorderState
  source: DictationLevelSource
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onCancel: () => void
}) {
  const theme = useAppTheme()
  const paused = state.phase === 'paused'
  const saving = state.phase === 'saving'
  const preparing = state.phase === 'preparing'
  const label = preparing ? 'Starting…' : saving ? 'Saving take…' : paused ? 'Paused' : 'Recording'
  // A take that reaches the limit carries on in a new one; say so as it gets close.
  const nearLimit = state.elapsedMs % (RECORDING_TAKE_MAX_SECONDS * 1000) >= (RECORDING_TAKE_MAX_SECONDS - 30) * 1000
  return (
    <View style={[styles.panel, { backgroundColor: theme.isDark ? theme.elevated : theme.background, borderColor: theme.separator }]} testID="recording-panel">
      <View style={styles.panelHeader}>
        <View style={[styles.liveDot, { backgroundColor: paused || preparing || saving ? theme.tertiary : RECORD_RED }]} />
        <Text accessibilityLiveRegion="polite" style={[styles.panelLabel, { color: theme.secondary }]}>{label}</Text>
        <Text accessibilityLabel={`Recorded ${formatRecordingTime(state.elapsedMs)}`} style={[styles.elapsed, { color: theme.text }]}>{formatRecordingTime(state.elapsedMs)}</Text>
      </View>
      <View style={styles.waveform}>
        <DictationWaveform source={source} color={paused ? theme.tertiary : theme.text} />
      </View>
      {nearLimit && !paused ? <Text style={[styles.note, { color: theme.secondary }]}>Long recordings continue in a new take every {RECORDING_TAKE_MAX_SECONDS / 60} minutes.</Text> : null}
      {state.error ? <Text style={[styles.note, { color: theme.orange }]}>{state.error}</Text> : null}
      <View style={styles.panelActions}>
        <RoundButton label="Discard take" symbol="xmark" onPress={onCancel} testID="recording-discard" />
        {saving || preparing ? <View style={styles.roundLarge}><ActivityIndicator color={theme.secondary} /></View> : (
          <RoundButton
            label={paused ? 'Resume recording' : 'Pause recording'}
            symbol={paused ? 'mic.fill' : 'pause.fill'}
            onPress={paused ? onResume : onPause}
            prominent
            testID="recording-pause"
          />
        )}
        <Pressable
          accessibilityLabel="Stop and save take"
          accessibilityRole="button"
          disabled={saving || preparing}
          onPress={onStop}
          style={({ pressed }) => [styles.stopRing, { borderColor: theme.isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.18)', opacity: saving || preparing ? 0.4 : pressed ? 0.7 : 1 }]}
          testID="recording-stop"
        >
          <View style={[styles.stopSquare, { backgroundColor: RECORD_RED }]} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  recordRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  recordDot: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  panel: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 10 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  panelLabel: { flex: 1, fontSize: 15 },
  elapsed: { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  waveform: { height: 28, flexDirection: 'row' },
  note: { fontSize: 13, lineHeight: 18 },
  panelActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  roundLarge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  stopRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 26, height: 26, borderRadius: 6 },
})
