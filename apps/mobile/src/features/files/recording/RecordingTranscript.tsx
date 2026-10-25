import { Button as SwiftUIButton, Host as SwiftUIHost, Image as SwiftUIImage, Menu as SwiftUIMenu } from '@expo/ui/swift-ui'
import { accessibilityLabel, frame } from '@expo/ui/swift-ui/modifiers'
import { formatRecordingTime, type TranscriptLine } from '@pulpo/client-core/files'
import type { RecordingClip } from '@pulpo/contracts'
import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react'
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ItemContextMenuView, itemContextMenuAvailable, type ContextMenuAction } from '../../../native/ItemContextMenuView'
import { showActions } from '../../../platform/materialActions'
import { MaterialMenu, type Action } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { takeTitle, type TranscriptRow } from './rows'

export type LineAction = 'play' | 'skip' | 'keep' | 'copy'
export type TakeAction = 'play' | 'retry' | 'delete'

/** After the user scrolls the transcript, it stops following playback for this long. */
const FOLLOW_PAUSE_MS = 4_000

interface Props {
  rows: TranscriptRow[]
  activeKey: string | null
  /** Whether skips and takes can be changed (not while the recording is in the trash). */
  editable: boolean
  /** Whether the server transcribes takes, so failed ones can be tried again. */
  transcription: boolean
  header?: ReactElement | null
  footer?: ReactElement | null
  empty: ReactElement | null
  bottomInset: number
  onLine: (line: TranscriptLine, action: LineAction) => void
  onTake: (clip: RecordingClip, action: TakeAction) => void
}

function lineActions(line: TranscriptLine, editable: boolean): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [{ id: 'play', title: 'Play From Here', systemImage: 'play', section: 0 }]
  if (editable) actions.push(line.skipped
    ? { id: 'keep', title: 'Don’t Skip', systemImage: 'arrow.uturn.backward', section: 1 }
    : { id: 'skip', title: 'Skip This Part', systemImage: 'arrow.uturn.forward', section: 1 })
  actions.push({ id: 'copy', title: 'Copy', systemImage: 'doc.on.doc', section: 2 })
  return actions
}

const Line = memo(function Line({ line, active, editable, onLine }: { line: TranscriptLine; active: boolean; editable: boolean; onLine: Props['onLine'] }) {
  const theme = useAppTheme()
  const time = formatRecordingTime(line.startMs)
  const content = (
    <View style={[styles.line, active && { backgroundColor: theme.fillStrong }]}>
      <Text style={[styles.lineTime, { color: active ? theme.red : theme.tertiary }]}>{time}</Text>
      <Text style={[styles.lineText, { color: line.skipped ? theme.tertiary : theme.text }, line.skipped && styles.skippedText]}>{line.text}</Text>
    </View>
  )
  const label = `${time}, ${line.skipped ? 'skipped, ' : ''}${line.text}`
  const actions = lineActions(line, editable)
  if (Platform.OS === 'ios' && itemContextMenuAvailable) {
    return (
      <ItemContextMenuView
        accessible
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityHint="Double tap to play from here. Touch and hold for more."
        actions={actions}
        preview={{ title: line.text, subtitle: line.skipped ? `${time} · Skipped` : time }}
        onAction={(action) => onLine(line, action as LineAction)}
        onPress={() => onLine(line, 'play')}
        testID={`recording-line-${line.key}`}
      >
        <View pointerEvents="none">{content}</View>
      </ItemContextMenuView>
    )
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      delayLongPress={350}
      onPress={() => onLine(line, 'play')}
      onLongPress={() => showActions(line.text, actions.filter((action) => action.id !== 'play').map((action) => ({
        label: action.title,
        icon: action.systemImage,
        onPress: () => onLine(line, action.id as LineAction),
      })))}
      android_ripple={{ color: theme.fill }}
      testID={`recording-line-${line.key}`}
    >
      {content}
    </Pressable>
  )
})

function TakeMenu({ clip, editable, transcription, onTake }: { clip: RecordingClip; editable: boolean; transcription: boolean; onTake: Props['onTake'] }) {
  const theme = useAppTheme()
  const retry = editable && transcription && (clip.transcript.status === 'failed' || clip.transcript.status === 'unavailable')
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost ignoreSafeArea="all" matchContents style={styles.menuHost}>
        <SwiftUIMenu
          label={<SwiftUIImage systemName="ellipsis.circle" size={18} color={theme.secondary} modifiers={[frame({ width: 32, height: 32 })]} />}
          modifiers={[accessibilityLabel('Take options')]}
        >
          <SwiftUIButton label="Play From Here" systemImage="play" onPress={() => onTake(clip, 'play')} />
          {retry ? <SwiftUIButton label="Transcribe Again" systemImage="arrow.clockwise" onPress={() => onTake(clip, 'retry')} /> : null}
          {editable ? <SwiftUIButton label="Delete Take" systemImage="trash" role="destructive" onPress={() => onTake(clip, 'delete')} /> : null}
        </SwiftUIMenu>
      </SwiftUIHost>
    )
  }
  const actions: Action[] = [{ label: 'Play from here', icon: 'play.fill', onPress: () => onTake(clip, 'play') }]
  if (retry) actions.push({ label: 'Transcribe again', icon: 'arrow.clockwise', onPress: () => onTake(clip, 'retry') })
  if (editable) actions.push({ label: 'Delete take', icon: 'trash', destructive: true, onPress: () => onTake(clip, 'delete') })
  return <MaterialMenu label="Take options" icon="ellipsis" compact actions={actions} />
}

function TakeHeading({ row, editable, transcription, onTake }: { row: Extract<TranscriptRow, { type: 'take' }>; editable: boolean; transcription: boolean; onTake: Props['onTake'] }) {
  const theme = useAppTheme()
  return (
    <View style={[styles.take, row.index > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Pressable accessibilityRole="button" accessibilityHint="Plays this take." onPress={() => onTake(row.clip, 'play')} style={styles.takeTitle}>
        <Text accessibilityRole="header" style={[styles.takeLabel, { color: theme.text }]}>{takeTitle(row.index, row.clip.recordedAt)}</Text>
        <Text style={[styles.takeMeta, { color: theme.secondary }]}>{formatRecordingTime(row.startMs)} · {formatRecordingTime(row.clip.durationMs)} long</Text>
      </Pressable>
      <TakeMenu clip={row.clip} editable={editable} transcription={transcription} onTake={onTake} />
    </View>
  )
}

function TakeNote({ row, editable, transcription, onTake }: { row: Extract<TranscriptRow, { type: 'note' }>; editable: boolean; transcription: boolean; onTake: Props['onTake'] }) {
  const theme = useAppTheme()
  const { clip } = row
  if (row.note === 'pending') {
    return (
      <View style={styles.note} testID="recording-transcribing">
        <ActivityIndicator size="small" color={theme.secondary} />
        <Text style={[styles.noteText, { color: theme.secondary }]}>Transcribing…</Text>
      </View>
    )
  }
  const retry = editable && transcription && row.note !== 'silent'
  const text = row.note === 'silent' ? 'No speech in this take.'
    : row.note === 'unavailable' ? (transcription ? 'Not transcribed: transcription was off when this was recorded.' : 'Not transcribed: transcription is turned off.')
      : clip.transcript.error ?? 'The transcript couldn’t be made.'
  return (
    <View style={styles.note}>
      <SymbolView name={row.note === 'failed' ? 'exclamationmark.triangle' : 'waveform'} size={15} tintColor={row.note === 'failed' ? theme.orange : theme.tertiary} />
      <Text style={[styles.noteText, { color: theme.secondary }]}>{text}</Text>
      {retry ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onTake(clip, 'retry')}>
          <Text style={[styles.noteAction, { color: theme.blue }]}>{row.note === 'failed' ? 'Try Again' : 'Transcribe'}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * The recording's transcript, take by take. The line being heard is highlighted and kept in view
 * unless the user is reading elsewhere; skipped lines are struck through.
 */
export function RecordingTranscript({ rows, activeKey, editable, transcription, header, footer, empty, bottomInset, onLine, onTake }: Props) {
  const list = useRef<FlatList<TranscriptRow>>(null)
  const scrolledAt = useRef(0)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    if (!activeKey || Date.now() - scrolledAt.current < FOLLOW_PAUSE_MS) return
    const index = rowsRef.current.findIndex((row) => row.key === activeKey)
    if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0.35, animated: true })
  }, [activeKey])

  const renderItem = useCallback(({ item }: { item: TranscriptRow }) => {
    if (item.type === 'take') return <TakeHeading row={item} editable={editable} transcription={transcription} onTake={onTake} />
    if (item.type === 'note') return <TakeNote row={item} editable={editable} transcription={transcription} onTake={onTake} />
    return <Line line={item.line} active={item.key === activeKey} editable={editable} onLine={onLine} />
  }, [activeKey, editable, onLine, onTake, transcription])

  return (
    <FlatList
      ref={list}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={renderItem}
      extraData={activeKey}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      onScrollBeginDrag={() => { scrolledAt.current = Date.now() }}
      onMomentumScrollEnd={() => { scrolledAt.current = Date.now() }}
      // Lines differ in height; jump near the line first, then to it once it is laid out.
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        list.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength - 120), animated: false })
        setTimeout(() => {
          if (index < rowsRef.current.length) list.current?.scrollToIndex({ index, viewPosition: 0.35, animated: true })
        }, 120)
      }}
      testID="recording-transcript"
    />
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12 },
  take: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 6, paddingLeft: 4, marginTop: 4 },
  takeTitle: { flex: 1, gap: 2 },
  takeLabel: { fontSize: 15, fontWeight: '600' },
  takeMeta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  menuHost: { width: 32, height: 32 },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
  lineTime: { width: 44, fontSize: 13, lineHeight: 22, fontVariant: ['tabular-nums'] },
  lineText: { flex: 1, fontSize: 16, lineHeight: 22 },
  skippedText: { textDecorationLine: 'line-through' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 8 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 19 },
  noteAction: { fontSize: 15, fontWeight: '600' },
})
