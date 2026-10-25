import {
  activeTranscriptLine,
  formatRecordingTime,
  nextRecordingRate,
  playableDurationMs,
  RECORDING_SEEK_MS,
  RecordingPlayback,
  recordingTimeline,
  transcriptLines,
  updateTimelineSkips,
  type TranscriptLine,
} from '@pulpo/client-core/files'
import type { FileRecording, RecordingClip, RecordingRange } from '@pulpo/contracts'
import { usePreventRemove } from '@react-navigation/native'
import type { NativeStackHeaderItem, NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Alert, AppState, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PageHeader } from '../../../mockup5/src/components/PrototypeUI'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { promptText, showActions } from '../../../platform/materialActions'
import { MaterialIconButton } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useSessionStore } from '../../../store/session'
import { useAppTheme } from '../../../theme'
import { speechPlayback } from '../../speech/state'
import { deleteRecordingClip, retryRecordingTranscript, updateRecordingSkips } from '../api'
import { useFilesEnabled } from '../availability'
import { FilesToastHost } from '../components/FilesToastHost'
import { FilesTurnedOff } from '../components/FilesTurnedOff'
import { FolderPickerSheet } from '../components/FolderPickerSheet'
import { filesErrorMessage } from '../display'
import { shareRecordingTranscript } from '../open'
import { refreshFiles, useFileOperations } from '../operations'
import { filesQueryKeys, recordingQuery } from '../queries'
import { useFilesNamespace } from '../useFilesNamespace'
import { loadClipAudio } from '../recording/clipAudio'
import { createNativeTakeRecorder } from '../recording/nativeRecorder'
import { RecorderPanel, RecordButton } from '../recording/RecorderControls'
import { RecordingTimelineView } from '../recording/RecordingTimelineView'
import { RecordingTranscript, type LineAction, type TakeAction } from '../recording/RecordingTranscript'
import { rangeSkipped, rangeTouchesSkip, takeTitle, transcriptRows, withSkips } from '../recording/rows'
import { discardTake, keepTake, resumeTakes, retryTake, usePendingTakes, type PendingTake } from '../recording/takes'

type Props = NativeStackScreenProps<RootStackParamList, 'FileRecording'>

/** Wide windows (iPad, landscape) put the transcript beside the player. */
const SIDE_BY_SIDE_MIN_WIDTH = 700
/** A part marked during playback shorter than this is taken as a mistap. */
const MIN_MARKED_MS = 300

function TransportButton({ label, symbol, onPress, disabled, size = 22, testID }: { label: string; symbol: string; onPress: () => void; disabled?: boolean; size?: number; testID?: string }) {
  const theme = useAppTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.transportButton, { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 }]}
      testID={testID}
    >
      <SymbolView name={symbol as never} size={size} tintColor={theme.text} weight="semibold" />
    </Pressable>
  )
}

function PendingTakeRow({ take }: { take: PendingTake }) {
  const theme = useAppTheme()
  const when = new Date(take.recordedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ')
  const status = take.state === 'uploading' ? 'Saving…' : take.state === 'waiting' ? 'Waiting to save' : take.error ?? 'Not saved'
  return (
    <View style={styles.pending} testID="recording-pending-take">
      {take.state === 'failed'
        ? <SymbolView name="exclamationmark.triangle.fill" size={18} tintColor={theme.orange} />
        : take.state === 'offline' ? <SymbolView name="icloud.slash" size={18} tintColor={theme.secondary} /> : <ActivityIndicator size="small" color={theme.secondary} />}
      <View style={styles.flex}>
        <Text style={[styles.pendingTitle, { color: theme.text }]}>Take recorded at {when} · {formatRecordingTime(take.durationMs)}</Text>
        <Text style={[styles.pendingStatus, { color: take.state === 'failed' ? theme.orange : theme.secondary }]}>{status}</Text>
      </View>
      {take.state === 'failed' || take.state === 'offline' ? (
        <>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => retryTake(take.id)}><Text style={[styles.pendingAction, { color: theme.blue }]}>Try Again</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard take"
            hitSlop={8}
            onPress={() => Alert.alert('Discard this take?', 'It hasn’t been saved, so its audio will be lost.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => { void discardTake(take.id) } },
            ])}
          >
            <SymbolView name="trash" size={17} tintColor={theme.red} />
          </Pressable>
        </>
      ) : null}
    </View>
  )
}

/**
 * A voice recording: its takes on one waveform with the player, the recorder that appends takes,
 * and the transcript beside or below. Parts can be marked to skip from the waveform, during
 * playback, or from the transcript.
 */
export function FileRecordingScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const queryClient = useQueryClient()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const operations = useFileOperations(namespace)
  const transcription = useSessionStore((state) => state.config?.capabilities.dictation === true)
  const fileId = route.params.fileId
  const queryKey = filesQueryKeys.recording(namespace, fileId)
  const recordingResult = useQuery({ ...recordingQuery(namespace, fileId), enabled: Boolean(namespace) && filesEnabled })
  const recording = recordingResult.data
  const node = recording?.node
  const editable = Boolean(node && !node.trashedAt)
  const title = node?.name ?? route.params.name ?? 'Voice Recording'

  const timeline = useMemo(() => recordingTimeline(recording?.clips ?? []), [recording?.clips])
  const lines = useMemo(() => transcriptLines(timeline), [timeline])
  const rows = useMemo(() => transcriptRows(timeline, lines), [lines, timeline])
  const allPendingTakes = usePendingTakes((state) => state.takes)
  const pendingTakes = useMemo(() => allPendingTakes.filter((take) => take.namespace === namespace && take.recordingId === fileId), [allPendingTakes, fileId, namespace])

  // Playback of every take as one piece of audio.
  const [playback] = useState(() => new RecordingPlayback({
    load: (clip, signal) => loadClipAudio(fileId, clip, signal),
    intervalMs: 100,
    errorMessage: (error) => filesErrorMessage(error),
  }))
  const player = useSyncExternalStore(playback.subscribe, playback.getSnapshot)
  useEffect(() => { playback.setTimeline(timeline) }, [playback, timeline])
  useEffect(() => playback.dispose, [playback])

  // The recorder appends takes; finished ones are kept on this device until they are saved.
  const [recorder] = useState(createNativeTakeRecorder)
  const recorderState = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot)
  const recordingNow = recorderState.phase !== 'idle'
  const keepRecordedTake = useCallback((take: Parameters<typeof keepTake>[2]) => {
    void keepTake(namespace, fileId, take, queryClient).catch((error) => Alert.alert('Couldn’t keep the take', filesErrorMessage(error)))
  }, [fileId, namespace, queryClient])
  const startRecording = useCallback(() => {
    if (!editable || recorder.active) return
    playback.pause()
    speechPlayback.stop()
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    void recorder.start(keepRecordedTake)
  }, [editable, keepRecordedTake, playback, recorder])
  const stopRecording = useCallback(() => {
    void recorder.stop().then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
  }, [recorder])
  const cancelRecording = useCallback(() => {
    Alert.alert('Discard this take?', 'What you’ve recorded since pressing Record will be lost.', [
      { text: 'Keep Recording', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: recorder.cancel },
    ])
  }, [recorder])

  useEffect(() => { if (namespace) void resumeTakes(namespace, queryClient).catch(() => undefined) }, [namespace, queryClient])
  // Recording can't go on in the background: the take so far is saved, as on leaving the screen.
  // (iOS is only briefly inactive for Control Center or a banner; recording goes on through that.)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'background') return
      playback.pause()
      if (recorder.active && !recorder.requestingPermission) void recorder.stop()
    })
    return () => {
      subscription.remove()
      if (recorder.active) void recorder.stop()
    }
  }, [playback, recorder])
  // Leaving while a take is open asks what to do with it; the native back gesture waits too.
  usePreventRemove(recordingNow, ({ data }) => {
    Alert.alert('Save this take?', 'You’re still recording.', [
      { text: 'Keep Recording', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { recorder.cancel(); navigation.dispatch(data.action) } },
      { text: 'Save', onPress: () => { void recorder.stop().then(() => navigation.dispatch(data.action)) } },
    ])
  })

  // Skips: edited optimistically, one change at a time, from the latest copy of the recording.
  const skipQueue = useRef(Promise.resolve())
  const setSkipped = useCallback((range: RecordingRange, skipped: boolean) => {
    skipQueue.current = skipQueue.current.then(async () => {
      const current = queryClient.getQueryData<FileRecording>(queryKey)
      if (!current) return
      const updates = updateTimelineSkips(recordingTimeline(current.clips), range, skipped)
      queryClient.setQueryData<FileRecording>(queryKey, withSkips(current, updates))
      try {
        queryClient.setQueryData<FileRecording>(queryKey, await updateRecordingSkips(fileId, updates))
        void Haptics.selectionAsync()
      } catch (error) {
        queryClient.setQueryData<FileRecording>(queryKey, current)
        operations.fail(error, current.node.name)
      }
    })
  }, [fileId, operations, queryClient, queryKey])

  const [selection, setSelection] = useState<RecordingRange | null>(null)
  const [markStart, setMarkStart] = useState<number | null>(null)
  useEffect(() => { if (!editable) { setSelection(null); setMarkStart(null) } }, [editable])
  const markSkip = useCallback(() => {
    const position = playback.livePosition()
    if (markStart === null) {
      setMarkStart(position)
      void Haptics.selectionAsync()
      return
    }
    setMarkStart(null)
    const range = { startMs: Math.min(markStart, position), endMs: Math.max(markStart, position) }
    if (range.endMs - range.startMs >= MIN_MARKED_MS) setSkipped(range, true)
  }, [markStart, playback, setSkipped])

  const onLine = useCallback((line: TranscriptLine, action: LineAction) => {
    if (action === 'play') {
      playback.seek(line.startMs)
      if (!recorder.active) playback.play()
    } else if (action === 'copy') void Clipboard.setStringAsync(line.text)
    else setSkipped({ startMs: line.startMs, endMs: Math.max(line.endMs, line.startMs + MIN_MARKED_MS) }, action === 'skip')
  }, [playback, recorder, setSkipped])

  const onTake = useCallback((clip: RecordingClip, action: TakeAction) => {
    const index = timeline.clips.findIndex((entry) => entry.clip.id === clip.id)
    if (action === 'play') {
      const entry = timeline.clips[index]
      if (!entry) return
      playback.seek(entry.startMs)
      if (!recorder.active) playback.play()
      return
    }
    if (action === 'retry') {
      void retryRecordingTranscript(fileId, clip.id).then((updated) => {
        queryClient.setQueryData<FileRecording>(queryKey, (current) => current && { ...current, clips: current.clips.map((candidate) => candidate.id === updated.id ? updated : candidate) })
      }, (error) => operations.fail(error))
      return
    }
    Alert.alert(`Delete ${takeTitle(index, clip.recordedAt).split(' · ')[0]}?`, 'Its audio and transcript will be deleted. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Take', style: 'destructive', onPress: () => {
        void deleteRecordingClip(fileId, clip.id).then((next) => {
          queryClient.setQueryData<FileRecording>(queryKey, next)
          void refreshFiles(queryClient, namespace)
        }, (error) => operations.fail(error))
      } },
    ])
  }, [fileId, namespace, operations, playback, queryClient, queryKey, recorder, timeline])

  // Organizing the recording, as the document screen does.
  const [moving, setMoving] = useState(false)
  const rename = useCallback(() => {
    if (!node) return
    promptText({ title: 'Rename', value: node.name, confirmLabel: 'Rename', onSubmit: (value) => {
      if (value.trim()) void operations.rename(node, value.trim()).then(() => recordingResult.refetch())
    } })
  }, [node, operations, recordingResult])
  const share = useCallback(() => {
    if (node) void shareRecordingTranscript(node).catch((error) => operations.fail(error, node.name))
  }, [node, operations])
  const trash = useCallback(() => {
    if (!node) return
    Alert.alert(`Move “${node.name}” to the trash?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move to Trash', style: 'destructive', onPress: () => {
        void operations.trash([node]).then((done) => {
          if (!done) return
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          navigation.goBack()
        })
      } },
    ])
  }, [navigation, node, operations])
  const showInFolder = useCallback(() => {
    if (node) navigation.push('FilesFolder', { folderId: node.parentId })
  }, [navigation, node])
  const hasTakes = timeline.clips.length > 0

  const menu: NativeStackHeaderItem = useMemo(() => ({
    type: 'menu',
    label: 'Recording',
    icon: { type: 'sfSymbol', name: 'ellipsis' },
    identifier: 'recording-menu',
    menu: {
      items: [
        { type: 'action', label: 'Share Transcript…', icon: { type: 'sfSymbol', name: 'square.and.arrow.up' }, disabled: !hasTakes, onPress: share },
        { type: 'action', label: 'Play Skipped Parts', icon: { type: 'sfSymbol', name: 'eye' }, state: player.skipping ? 'off' : 'on', disabled: !timeline.skips.length, onPress: () => playback.setSkipping(!player.skipping) },
        {
          type: 'submenu',
          label: 'Organize',
          inline: true,
          items: [
            { type: 'action', label: 'Rename', icon: { type: 'sfSymbol', name: 'pencil' }, disabled: !editable, onPress: rename },
            { type: 'action', label: 'Move…', icon: { type: 'sfSymbol', name: 'folder' }, disabled: !editable, onPress: () => setMoving(true) },
            { type: 'action', label: 'Duplicate', icon: { type: 'sfSymbol', name: 'plus.square.on.square' }, disabled: !node, onPress: () => { if (node) void operations.duplicate([node], node.parentId) } },
            { type: 'action', label: node?.pinned ? 'Unpin' : 'Pin', icon: { type: 'sfSymbol', name: node?.pinned ? 'pin.slash' : 'pin' }, disabled: !node, onPress: () => { if (node) void operations.setPinned([node], !node.pinned).then(() => recordingResult.refetch()) } },
            { type: 'action', label: 'Show in Folder', icon: { type: 'sfSymbol', name: 'folder.badge.questionmark' }, disabled: !node, onPress: showInFolder },
          ],
        },
        { type: 'action', label: 'Move to Trash', icon: { type: 'sfSymbol', name: 'trash' }, destructive: true, disabled: !editable, onPress: trash },
      ],
    },
  }), [editable, hasTakes, node, operations, playback, player.skipping, recordingResult, rename, share, showInFolder, timeline.skips.length, trash])

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerShown: Platform.OS === 'ios',
      headerLargeTitle: false,
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' && filesEnabled ? () => [menu] : undefined,
    })
  })
  const showAndroidMenu = () => showActions(title, [
    { label: 'Share transcript', icon: 'square.and.arrow.up', disabled: !hasTakes, onPress: share },
    { label: player.skipping ? 'Play skipped parts' : 'Skip marked parts', icon: 'eye', disabled: !timeline.skips.length, onPress: () => playback.setSkipping(!player.skipping) },
    { label: 'Rename', icon: 'pencil', disabled: !editable, onPress: rename },
    { label: 'Move', icon: 'folder', disabled: !editable, onPress: () => setMoving(true) },
    { label: 'Duplicate', icon: 'plus.square.on.square', onPress: () => { if (node) void operations.duplicate([node], node.parentId) } },
    { label: 'Show in folder', icon: 'folder.badge.questionmark', onPress: showInFolder },
    { label: 'Move to trash', icon: 'trash', destructive: true, disabled: !editable, onPress: trash },
  ])

  if (!filesEnabled) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
        {Platform.OS === 'android' ? <PageHeader title={title} onBack={() => navigation.goBack()} /> : null}
        <FilesTurnedOff />
      </View>
    )
  }

  const playing = player.status === 'playing' || player.status === 'loading'
  const activeLine = player.status === 'idle' && player.positionMs === 0 ? null : activeTranscriptLine(lines, player.positionMs)
  const selectionSkipped = selection ? rangeSkipped(timeline.skips, selection) : false
  const selectionTouchesSkip = selection ? rangeTouchesSkip(timeline.skips, selection) : false

  const banner = node?.trashedAt ? (
    <View style={[styles.banner, { backgroundColor: theme.fill }]} testID="recording-trashed">
      <View style={styles.flex}>
        <Text style={[styles.bannerTitle, { color: theme.text }]}>This recording is in the trash</Text>
        <Text style={[styles.bannerDetail, { color: theme.secondary }]}>Restore it to record or change what’s skipped.</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => { void operations.restore([node]).then(() => recordingResult.refetch()) }}>
        <Text style={[styles.bannerAction, { color: theme.blue }]}>Restore</Text>
      </Pressable>
    </View>
  ) : null

  const playerPanel = hasTakes ? (
    <View style={styles.player}>
      <RecordingTimelineView
        timeline={timeline}
        positionMs={player.positionMs}
        selection={selection}
        markStartMs={markStart}
        selectable={editable}
        onSeek={(ms) => { setSelection(null); playback.seek(ms) }}
        onSeekBy={(delta) => playback.seekBy(delta)}
        onSelect={setSelection}
      />
      <View style={styles.times}>
        <Text style={[styles.time, { color: theme.secondary }]}>{formatRecordingTime(player.positionMs)}</Text>
        {timeline.skips.length ? (
          <Text style={[styles.timeNote, { color: theme.tertiary }]}>
            {player.skipping ? `Plays ${formatRecordingTime(playableDurationMs(timeline))} · ${timeline.skips.length} skipped` : 'Playing skipped parts'}
          </Text>
        ) : null}
        <Text style={[styles.time, { color: theme.secondary }]}>{formatRecordingTime(timeline.durationMs)}</Text>
      </View>
      {selection ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.fill }]} testID="recording-selection">
          <Text style={[styles.selectionLabel, { color: theme.text }]}>{formatRecordingTime(selection.startMs)}–{formatRecordingTime(selection.endMs)}</Text>
          {!selectionSkipped ? (
            <Pressable accessibilityRole="button" onPress={() => { setSkipped(selection, true); setSelection(null) }} style={styles.selectionAction}>
              <Text style={[styles.selectionActionLabel, { color: theme.blue }]}>Skip</Text>
            </Pressable>
          ) : null}
          {selectionTouchesSkip ? (
            <Pressable accessibilityRole="button" onPress={() => { setSkipped(selection, false); setSelection(null) }} style={styles.selectionAction}>
              <Text style={[styles.selectionActionLabel, { color: theme.blue }]}>Don’t Skip</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityLabel="Clear selection" accessibilityRole="button" hitSlop={8} onPress={() => setSelection(null)}>
            <SymbolView name="xmark.circle.fill" size={20} tintColor={theme.tertiary} />
          </Pressable>
        </View>
      ) : editable && !playing && !timeline.skips.length ? (
        <Text style={[styles.hint, { color: theme.tertiary }]}>Touch and hold the waveform, then drag, to select a part to skip.</Text>
      ) : null}
      <View style={styles.transport}>
        <Pressable
          accessibilityLabel={`Playback speed ${player.rate} times`}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => playback.setRate(nextRecordingRate(player.rate))}
          style={({ pressed }) => [styles.speed, { backgroundColor: theme.fill, opacity: pressed ? 0.55 : 1 }]}
          testID="recording-speed"
        >
          <Text style={[styles.speedLabel, { color: theme.text }]}>{player.rate}×</Text>
        </Pressable>
        <TransportButton label="Back 15 seconds" symbol="gobackward.15" disabled={recordingNow} onPress={() => playback.seekBy(-RECORDING_SEEK_MS)} />
        <Pressable
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          accessibilityRole="button"
          disabled={recordingNow}
          onPress={playback.toggle}
          style={({ pressed }) => [styles.play, { backgroundColor: theme.text, opacity: recordingNow ? 0.35 : pressed ? 0.7 : 1 }]}
          testID="recording-play"
        >
          {player.status === 'loading'
            ? <ActivityIndicator color={theme.background} />
            : <SymbolView name={playing ? 'pause.fill' : 'play.fill'} size={26} tintColor={theme.background} />}
        </Pressable>
        <TransportButton label="Forward 15 seconds" symbol="goforward.15" disabled={recordingNow} onPress={() => playback.seekBy(RECORDING_SEEK_MS)} />
        {editable ? (
          <Pressable
            accessibilityLabel={markStart === null ? 'Mark a part to skip' : 'End the part to skip here'}
            accessibilityHint={markStart === null ? 'Marks where the part starts; press again where it ends.' : undefined}
            accessibilityRole="button"
            disabled={recordingNow}
            hitSlop={6}
            onPress={markSkip}
            onLongPress={() => setMarkStart(null)}
            style={({ pressed }) => [styles.speed, { backgroundColor: markStart === null ? theme.fill : theme.orange, opacity: recordingNow ? 0.35 : pressed ? 0.55 : 1 }]}
            testID="recording-mark-skip"
          >
            <Text style={[styles.speedLabel, { color: markStart === null ? theme.text : '#FFFFFF' }]}>{markStart === null ? 'Skip…' : 'End'}</Text>
          </Pressable>
        ) : <View style={styles.speedPlaceholder} />}
      </View>
      {markStart !== null ? (
        <Text style={[styles.hint, { color: theme.orange }]}>Skipping from {formatRecordingTime(markStart)}. Press End where the part ends, or hold to cancel.</Text>
      ) : null}
      {player.error ? <Text style={[styles.hint, { color: theme.orange }]}>{player.error}</Text> : null}
    </View>
  ) : null

  const recorderControls = editable ? (
    <View style={[styles.recorder, { paddingBottom: insets.bottom + 12 }]}>
      {recordingNow ? (
        <View style={styles.recorderPanel}>
          <RecorderPanel state={recorderState} source={recorder} onPause={recorder.pause} onResume={recorder.resume} onStop={stopRecording} onCancel={cancelRecording} />
        </View>
      ) : (
        <>
          {recorderState.error ? <Text style={[styles.recorderError, { color: theme.orange }]}>{recorderState.error}</Text> : null}
          <RecordButton busy={false} disabled={!recording} hasTakes={hasTakes} onPress={startRecording} />
        </>
      )}
    </View>
  ) : <View style={{ height: insets.bottom }} />

  const empty = recordingResult.isError ? (
    <View style={styles.center}>
      <SymbolView name="exclamationmark.triangle" size={36} tintColor={theme.tertiary} />
      <Text style={[styles.centerText, { color: theme.secondary }]}>{filesErrorMessage(recordingResult.error)}</Text>
    </View>
  ) : !recording ? (
    <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>
  ) : pendingTakes.length ? null : (
    <View style={styles.center} testID="recording-empty">
      <SymbolView name="waveform" size={40} tintColor={theme.tertiary} />
      <Text style={[styles.centerTitle, { color: theme.text }]}>{recordingNow ? 'Recording your first take…' : editable ? 'Tap record to start.' : 'Nothing was recorded.'}</Text>
      {editable ? (
        <Text style={[styles.centerText, { color: theme.secondary }]}>
          {transcription
            ? 'Each time you record, a take is added at the end. Its transcript appears here once it’s saved.'
            : 'Each time you record, a take is added at the end. Transcription is turned off, so takes won’t have transcripts.'}
        </Text>
      ) : null}
    </View>
  )
  const footer = pendingTakes.length ? <View style={styles.pendingList}>{pendingTakes.map((take) => <PendingTakeRow key={take.id} take={take} />)}</View> : null
  const transcript = (
    <RecordingTranscript
      rows={rows}
      activeKey={activeLine?.key ?? null}
      editable={editable}
      transcription={transcription}
      footer={footer}
      empty={empty}
      bottomInset={24}
      onLine={onLine}
      onTake={onTake}
    />
  )
  const sideBySide = windowWidth >= SIDE_BY_SIDE_MIN_WIDTH

  return (
    <View style={[styles.flex, { backgroundColor: theme.isDark ? theme.background : theme.elevated, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
      {Platform.OS === 'android' ? (
        <PageHeader title={title} onBack={() => navigation.goBack()} right={<MaterialIconButton icon="ellipsis" label="Recording" onPress={showAndroidMenu} />} />
      ) : null}
      {banner}
      {sideBySide ? (
        <View style={[styles.flex, styles.row]}>
          <View style={[styles.sidePane, { borderRightColor: theme.separator }]}>
            {playerPanel}
            <View style={styles.flex} />
            {recorderControls}
          </View>
          <View style={styles.flex}>{transcript}</View>
        </View>
      ) : (
        <>
          {playerPanel}
          {hasTakes ? <View style={[styles.divider, { backgroundColor: theme.separator }]} /> : null}
          <View style={styles.flex}>{transcript}</View>
          {recorderControls}
        </>
      )}
      <FilesToastHost bottomOffset={editable ? 110 : 0} />
      {moving && node ? (
        <FolderPickerSheet
          namespace={namespace}
          mode="destination"
          title={`Move “${node.name}”`}
          confirmLabel="Move Here"
          initialFolderId={node.parentId}
          excludeIds={[node.id]}
          sourceFolderIds={[node.parentId]}
          onCancel={() => setMoving(false)}
          onConfirm={(destination) => {
            setMoving(false)
            void operations.move([node], destination).then(() => recordingResult.refetch())
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  sidePane: { width: '46%', maxWidth: 520, borderRightWidth: StyleSheet.hairlineWidth },
  divider: { height: StyleSheet.hairlineWidth },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: 14 },
  bannerTitle: { fontSize: 15, fontWeight: '600' },
  bannerDetail: { fontSize: 13, marginTop: 2 },
  bannerAction: { fontSize: 15, fontWeight: '600' },
  player: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 8 },
  times: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
  timeNote: { flex: 1, textAlign: 'center', fontSize: 12 },
  hint: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  selectionBar: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  selectionLabel: { flex: 1, fontSize: 14, fontVariant: ['tabular-nums'] },
  selectionAction: { paddingVertical: 2 },
  selectionActionLabel: { fontSize: 15, fontWeight: '600' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  transportButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  play: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  speed: { minWidth: 56, height: 32, borderRadius: 16, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  speedPlaceholder: { width: 56 },
  speedLabel: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  recorder: { alignItems: 'center', paddingTop: 12, paddingHorizontal: 12, gap: 8 },
  recorderPanel: { alignSelf: 'stretch' },
  recorderError: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32, paddingVertical: 48 },
  centerTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  centerText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  pendingList: { paddingTop: 8 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  pendingTitle: { fontSize: 15 },
  pendingStatus: { fontSize: 13, marginTop: 2 },
  pendingAction: { fontSize: 15, fontWeight: '600' },
})
