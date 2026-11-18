import { SPEECH_SEEK_SECONDS, speechClock } from '@pulpo/client-core'
import { audioTranscriptionMimeType, MAX_AUDIO_TRANSCRIPTION_BYTES, type AudioTranscript } from '@pulpo/contracts'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { setAudioModeAsync, setIsAudioActiveAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import * as Clipboard from 'expo-clipboard'
import { File } from 'expo-file-system'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassIconButton, NativeSwitch, PageHeader, PrimaryButton } from '../../../mockup5/src/components/PrototypeUI'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { shareLocalFile } from '../../../native/shareFile'
import { MaterialIconButton } from '../../../platform/MaterialUI'
import { useSessionStore } from '../../../store/session'
import { useAppTheme } from '../../../theme'
import { transcribeAudioFile } from '../../chat/transcribeAudio'
import { speechPlayback } from '../../speech/state'

type Props = NativeStackScreenProps<RootStackParamList, 'AudioPreview'>

export function AudioPreviewScreen({ navigation, route }: Props) {
  const { uri, name, mimeType } = route.params
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const enabled = useSessionStore((state) => state.status === 'authenticated' && state.config?.capabilities.dictation === true)
  const [size] = useState(() => new File(uri).size)
  const [transcript, setTranscript] = useState<AudioTranscript | null>(null)
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  const player = useAudioPlayer(uri)
  const status = useAudioPlayerStatus(player)
  const starting = useRef(false)
  const [playbackError, setPlaybackError] = useState('')
  const duration = Number.isFinite(status.duration) ? Math.max(0, status.duration) : 0
  const elapsed = Math.min(duration, Math.max(0, status.currentTime))
  const progress = duration ? elapsed / duration : 0

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => player.pause())
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') player.pause()
    })
    return () => {
      unsubscribe()
      subscription.remove()
    }
  }, [navigation, player])

  const type = audioTranscriptionMimeType(mimeType)
  const unavailable = !enabled ? 'Audio transcription is unavailable on this instance.'
    : !type ? 'This audio format is not supported for transcription.'
    : size > MAX_AUDIO_TRANSCRIPTION_BYTES ? 'Audio must be 10 MiB or smaller to transcribe.'
    : !size ? 'This audio file is empty or unavailable.' : null

  async function transcribe() {
    if (unavailable || !type || request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setTranscriptionError('')
    try {
      const result = await transcribeAudioFile(uri, name, type, controller.signal)
      if (!controller.signal.aborted) setTranscript(result)
    } catch (error) {
      if (!controller.signal.aborted) setTranscriptionError(error instanceof Error ? error.message : 'Unable to transcribe audio.')
    } finally {
      request.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  async function togglePlayback() {
    if (starting.current) return
    if (player.playing) {
      player.pause()
      return
    }
    starting.current = true
    setPlaybackError('')
    try {
      speechPlayback.stop()
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false })
      await setIsAudioActiveAsync(true)
      if (!navigation.isFocused() || AppState.currentState !== 'active') return
      if (status.didJustFinish || (duration > 0 && player.currentTime >= duration)) await player.seekTo(0)
      if (navigation.isFocused() && AppState.currentState === 'active') player.play()
    } catch {
      if (navigation.isFocused()) setPlaybackError('This audio could not be played.')
    } finally {
      starting.current = false
    }
  }

  function seek(offset: number) {
    if (!status.isLoaded || !duration) return
    void player.seekTo(Math.min(duration, Math.max(0, player.currentTime + offset)))
      .catch(() => setPlaybackError('Couldn’t change playback position.'))
  }

  const share = useCallback(() => {
    void shareLocalFile(uri, name, mimeType).catch(() => Alert.alert('Couldn’t share audio'))
  }, [uri, name, mimeType])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' ? () => [
        { type: 'button', label: 'Share', icon: { type: 'sfSymbol', name: 'square.and.arrow.up' }, onPress: share },
      ] : undefined,
    })
  }, [name, navigation, share])

  return (
    <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
      {Platform.OS === 'android' && <PageHeader title={name} onBack={() => navigation.goBack()}
        right={<MaterialIconButton icon="square.and.arrow.up" label="Share" onPress={share} />} />}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.section}>
          <View style={styles.controls}>
            {!status.isLoaded && !status.error ? <ActivityIndicator color={theme.secondary} /> : status.isLoaded && (
              <>
                <GlassIconButton icon="gobackward.10" label="Back 10 seconds" onPress={() => seek(-SPEECH_SEEK_SECONDS)} />
                <GlassIconButton icon={status.playing ? 'pause.fill' : 'play.fill'} label={status.playing ? 'Pause' : 'Play'} onPress={() => void togglePlayback()} />
                <GlassIconButton icon="goforward.10" label="Forward 10 seconds" onPress={() => seek(SPEECH_SEEK_SECONDS)} />
              </>
            )}
          </View>
          {status.isLoaded && (
            <>
              <View style={[styles.track, { backgroundColor: theme.fillStrong }]}>
                <View style={[styles.track, { backgroundColor: theme.accent, width: `${100 * progress}%` }]} />
              </View>
              <Text style={[styles.time, { color: theme.secondary }]}>{`${speechClock(elapsed)} / ${speechClock(duration)}`}</Text>
            </>
          )}
          {(status.error || playbackError) && <Text accessibilityRole="alert" style={{ color: theme.red }}>{playbackError || 'This audio could not be played.'}</Text>}
          {transcript === null && (
            <PrimaryButton label={pending ? 'Transcribing…' : 'Transcribe'} variant="secondary" icon="waveform"
              loading={pending} disabled={pending || Boolean(unavailable)} onPress={() => void transcribe()} />
          )}
          {unavailable && transcript === null && <Text style={{ color: theme.secondary }}>{unavailable}</Text>}
          {transcriptionError ? <Text accessibilityRole="alert" style={{ color: theme.red }}>{transcriptionError}</Text> : null}
        </View>
        {transcript !== null && (
          <View style={[styles.section, styles.transcriptSection, { borderColor: theme.separator }]}>
            <View style={styles.transcriptHeader}>
              <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Transcript</Text>
              <GlassIconButton icon="doc.on.doc" label="Copy transcript" onPress={() => {
                void Clipboard.setStringAsync(transcript.text)
                  .then(() => AccessibilityInfo.announceForAccessibility('Transcript copied'))
                  .catch(() => Alert.alert('Couldn’t copy transcript'))
              }} />
            </View>
            {Boolean(transcript.segments?.length) && (
              <View style={styles.transcriptHeader}>
                <Text style={{ color: theme.secondary }}>Timestamps</Text>
                <NativeSwitch label="Timestamps" value={showTimestamps} onChange={setShowTimestamps} />
              </View>
            )}
            {showTimestamps && transcript.segments?.length ? transcript.segments.map((segment, index) => (
              <View key={index}>
                <Text style={[styles.timestamp, { color: theme.secondary }]}>{speechClock(segment.start)}–{speechClock(segment.end)}</Text>
                <Text selectable style={[styles.transcript, { color: theme.text }]}>{segment.text}</Text>
              </View>
            )) : <Text selectable style={[styles.transcript, { color: theme.text }]}>{transcript.text}</Text>}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' },
  section: { gap: 12 },
  transcriptSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  timestamp: { fontSize: 13, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20, minHeight: 44 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  time: { fontSize: 13, fontVariant: ['tabular-nums'], textAlign: 'center' },
  transcriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 16, fontWeight: '600' },
  transcript: { fontSize: 16, lineHeight: 24 },
})
