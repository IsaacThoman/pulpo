import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { FileRecording, RecordingRange, RecordingSkipUpdate } from '@pulpo/contracts'
import {
  activeTranscriptLine,
  formatRecordingTime,
  nextRecordingRate,
  playableDurationMs,
  RECORDING_SEEK_MS,
  recordingTimeline,
  recordingTranscriptText,
  skippedOverlapMs,
  transcriptLines,
  updateTimelineSkips,
  type TimelineClip,
} from '@pulpo/client-core/files'
import { Check, Copy, Loader2, Mic, Pause, Play, RotateCcw, RotateCw, Scissors, Square, TriangleAlert, X } from 'lucide-react'
import { DictationWaveform } from '@/components/chat/DictationBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { filesErrorMessage } from '@/features/files/file-display'
import { isEditableTarget, shortcutLabel } from '@/features/files/browser/shortcuts'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import {
  deleteRecordingClip,
  downloadRecordingClip,
  recordingQueryKey,
  retryRecordingTranscript,
  updateRecordingSkips,
} from './api'
import { RecordingTimeline } from './RecordingTimeline'
import { RecordingTranscript, type TranscriptActions } from './RecordingTranscript'
import { discardTake, retryTake, useTakeUploads } from './take-uploads'
import { useRecordingPlayback } from './use-recording-playback'
import { useTakeRecorder } from './use-take-recorder'

function IconButton({ label, shortcut, onClick, disabled, className, children }: {
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick} className={className}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}{shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}</TooltipContent>
    </Tooltip>
  )
}

/** The recording's skips with `updates` applied, shown before the server confirms them. */
function withSkips(recording: FileRecording, updates: RecordingSkipUpdate[]): FileRecording {
  return {
    ...recording,
    clips: recording.clips.map((clip) => ({
      ...clip,
      skips: updates.filter((skip) => skip.clipId === clip.id).map(({ startMs, endMs }) => ({ startMs, endMs })),
    })),
  }
}

/**
 * A voice recording: its waveform and transport, the recorder that appends takes, and the
 * transcript on one side. Parts can be marked to skip from the waveform, the transcript, or while
 * listening.
 */
export function RecordingEditor({ recording, editable, layout }: {
  recording: FileRecording
  editable: boolean
  layout: 'page' | 'panel'
}) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const transcriptionEnabled = useAuth((state) => state.dictationEnabled)
  const id = recording.node.id
  const timeline = useMemo(() => recordingTimeline(recording.clips), [recording.clips])
  const lines = useMemo(() => transcriptLines(timeline), [timeline])
  const { playback, state } = useRecordingPlayback(id, timeline)
  const recorder = useTakeRecorder(id, { onStart: () => playback.pause() })
  const allPending = useTakeUploads((uploads) => uploads.takes)
  const pending = allPending.filter((take) => take.recordingId === id)
  const [selection, setSelection] = useState<RecordingRange | null>(null)
  const [markStartMs, setMarkStartMs] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<{ entry: TimelineClip; index: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const skipRequest = useRef(0)

  const playing = state.status === 'playing' || state.status === 'loading'
  const recordingActive = recorder.phase !== 'idle'
  const hasTakes = timeline.clips.length > 0
  const active = activeTranscriptLine(lines, state.positionMs)
  const key = recordingQueryKey(userId, id)

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1_500)
    return () => window.clearTimeout(timer)
  }, [copied])

  // A selection outlives neither its recording's takes nor the end of the recording.
  useEffect(() => {
    if (selection && selection.startMs >= timeline.durationMs) setSelection(null)
  }, [selection, timeline.durationMs])

  const applySkips = (range: RecordingRange, skipped: boolean) => {
    if (!editable) return
    const updates = updateTimelineSkips(timeline, range, skipped)
    const request = ++skipRequest.current
    queryClient.setQueryData<FileRecording>(key, (current) => current && withSkips(current, updates))
    void updateRecordingSkips(id, updates)
      .then((saved) => { if (request === skipRequest.current) queryClient.setQueryData(key, saved) })
      .catch((cause: unknown) => {
        setNotice(filesErrorMessage(cause))
        void queryClient.invalidateQueries({ queryKey: key })
      })
  }

  const toggleMark = () => {
    if (!editable || !hasTakes) return
    const position = playback.livePosition()
    if (markStartMs === null) {
      setMarkStartMs(position)
      return
    }
    setMarkStartMs(null)
    if (position - markStartMs >= 200) applySkips({ startMs: markStartMs, endMs: position }, true)
    else if (markStartMs - position >= 200) applySkips({ startMs: position, endMs: markStartMs }, true)
  }

  const actions: TranscriptActions = {
    seek: (ms) => {
      playback.seek(ms)
      if (!playing) playback.play()
    },
    setSkipped: (line, skipped) => applySkips({ startMs: line.startMs, endMs: line.endMs }, skipped),
    retryTranscript: (clipId) => {
      void retryRecordingTranscript(id, clipId)
        .then(() => queryClient.invalidateQueries({ queryKey: key }))
        .catch((cause: unknown) => setNotice(filesErrorMessage(cause)))
    },
    downloadTake: (clipId) => { void downloadRecordingClip(id, clipId).catch((cause: unknown) => setNotice(filesErrorMessage(cause))) },
    deleteTake: (entry, index) => setDeleting({ entry, index }),
    retryUpload: retryTake,
    discardUpload: discardTake,
  }

  const confirmDelete = () => {
    const target = deleting
    setDeleting(null)
    if (!target) return
    void deleteRecordingClip(id, target.entry.clip.id)
      .then((saved) => queryClient.setQueryData(key, saved))
      .catch((cause: unknown) => setNotice(filesErrorMessage(cause)))
  }

  const copyTranscript = () => {
    void navigator.clipboard.writeText(recordingTranscriptText(recording.clips, { omitSkipped: true }))
      .then(() => setCopied(true))
      .catch(() => setNotice(ui("The transcript couldn't be copied")))
  }

  // Space plays and pauses, the arrows move, S marks a skip, and R records: from within the
  // recording, or with nothing focused, but not while typing or working in a view beside it.
  const root = useRef<HTMLDivElement>(null)
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => undefined)
  shortcuts.current = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return
    const target = event.target instanceof Node ? event.target : null
    if (target && target !== document.body && !root.current?.contains(target)) return
    const key = event.key.toLowerCase()
    if (key === ' ' && !(event.target instanceof HTMLButtonElement)) {
      if (recordingActive) return
      event.preventDefault()
      playback.toggle()
    } else if (key === 'arrowleft' || key === 'arrowright') {
      if (!hasTakes) return
      event.preventDefault()
      playback.seekBy((key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? RECORDING_SEEK_MS : 5_000))
    } else if (key === 's' && editable && hasTakes && !recordingActive) {
      event.preventDefault()
      toggleMark()
    } else if (key === 'r' && editable) {
      event.preventDefault()
      if (recorder.phase === 'idle') recorder.start()
      else if (recorder.phase === 'recording' || recorder.phase === 'paused') recorder.stop()
    } else if (key === 'escape' && (selection || markStartMs !== null)) {
      setSelection(null)
      setMarkStartMs(null)
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcuts.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const selectionSkipped = selection ? skippedOverlapMs(timeline.skips, selection) : 0
  const selectionLength = selection ? selection.endMs - selection.startMs : 0
  const playable = playableDurationMs(timeline)
  const takeNumber = timeline.clips.length + pending.length + 1
  const wide = layout === 'page'

  const player = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-semibold tabular-nums tracking-tight" aria-live="off">
            {formatRecordingTime(state.positionMs)}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">/ {formatRecordingTime(timeline.durationMs)}</span>
          </div>
          {timeline.skips.length > 0 && (
            <span className="text-xs text-muted-foreground">{uit`${formatRecordingTime(playable)} with skips`}</span>
          )}
        </div>
        <div className="pt-6">
          <RecordingTimeline
            timeline={timeline}
            positionMs={state.positionMs}
            selection={selection}
            markStartMs={markStartMs}
            disabled={!hasTakes}
            onSeek={(ms) => playback.seek(ms)}
            onSelect={setSelection}
          />
        </div>
        {selection ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5 text-sm" role="toolbar" aria-label={ui("Selected part")}>
            <span className="px-1 tabular-nums text-muted-foreground">
              {uit`${formatRecordingTime(selection.startMs)}–${formatRecordingTime(selection.endMs)} selected`}
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => { playback.seek(selection.startMs); playback.play() }}><Play />{ui("Play")}</Button>
            {editable && selectionSkipped < selectionLength && (
              <Button size="sm" variant="ghost" onClick={() => { applySkips(selection, true); setSelection(null) }}><Scissors />{ui("Skip")}</Button>
            )}
            {editable && selectionSkipped > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { applySkips(selection, false); setSelection(null) }}><RotateCcw />{ui("Don't skip")}</Button>
            )}
            <IconButton label={ui("Clear selection")} shortcut="Esc" onClick={() => setSelection(null)} className="size-8"><X /></IconButton>
          </div>
        ) : (
          <div className="mt-3 flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
            <span>0:00</span>
            <span className="hidden min-w-0 truncate sm:inline">
              {hasTakes
                ? (editable ? ui("Drag across the waveform to select a part to skip") : uit`${timeline.clips.length} takes`)
                : ui("Nothing recorded yet")}
            </span>
            <span>{formatRecordingTime(timeline.durationMs)}</span>
          </div>
        )}
      </div>

      {hasTakes && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <IconButton label={ui("Back 15 seconds")} shortcut={shortcutLabel('←', { shift: true })} onClick={() => playback.seekBy(-RECORDING_SEEK_MS)}><RotateCcw /></IconButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                className="size-12 rounded-full"
                aria-label={playing ? ui("Pause") : ui("Play")}
                disabled={recordingActive}
                onClick={playback.toggle}
              >
                {state.status === 'loading' ? <Loader2 className="size-5 animate-spin" /> : playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{playing ? ui("Pause") : ui("Play")}<span className="ml-2 text-muted-foreground">{ui("Space")}</span></TooltipContent>
          </Tooltip>
          <IconButton label={ui("Forward 15 seconds")} shortcut={shortcutLabel('→', { shift: true })} onClick={() => playback.seekBy(RECORDING_SEEK_MS)}><RotateCw /></IconButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="w-14 tabular-nums" onClick={() => playback.setRate(nextRecordingRate(state.rate))}>
                {`${state.rate}×`}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ui("Playback speed")}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {hasTakes && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          {timeline.skips.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
              <Switch checked={state.skipping} onCheckedChange={playback.setSkipping} />
              {ui("Skip marked parts")}
            </label>
          )}
          {editable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={markStartMs === null ? 'outline' : 'secondary'}
                  size="sm"
                  disabled={recordingActive}
                  onClick={toggleMark}
                  className={cn(markStartMs !== null && 'text-amber-700 dark:text-amber-300')}
                >
                  <Scissors />
                  {markStartMs === null ? ui("Mark skip") : uit`End skip (from ${formatRecordingTime(markStartMs)})`}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{markStartMs === null ? ui("Mark where a part to skip starts, then where it ends") : ui("Mark where the skipped part ends")}<span className="ml-2 text-muted-foreground">{shortcutLabel('S')}</span></TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {state.error && (
        <p role="alert" className="flex items-center justify-center gap-2 text-sm text-destructive"><TriangleAlert className="size-4" />{state.error}</p>
      )}

      {editable && (
        <div className="flex justify-center">
          {recordingActive ? (
            <div className="flex w-full max-w-xl items-center gap-2 rounded-full border bg-background p-1.5 shadow-sm" role="group" aria-label={ui("Recorder")}>
              <IconButton label={ui("Discard take")} onClick={recorder.discard} className="size-9 rounded-full text-muted-foreground"><X /></IconButton>
              <span className={cn('size-2.5 shrink-0 rounded-full bg-red-500', recorder.phase === 'recording' && 'animate-pulse')} />
              <span className="w-12 shrink-0 text-sm tabular-nums">{formatRecordingTime(recorder.elapsedMs)}</span>
              {recorder.phase === 'preparing'
                ? <span className="min-w-0 flex-1 text-sm text-muted-foreground">{ui("Waiting for microphone…")}</span>
                : <DictationWaveform levels={recorder.levels} />}
              {recorder.phase === 'paused' ? (
                <IconButton label={ui("Resume recording")} onClick={recorder.resume} className="size-9 rounded-full"><Mic /></IconButton>
              ) : (
                <IconButton label={ui("Pause recording")} disabled={recorder.phase !== 'recording'} onClick={recorder.pause} className="size-9 rounded-full"><Pause /></IconButton>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="rounded-full" disabled={recorder.phase === 'preparing'} onClick={recorder.stop}>
                    <Square className="size-3.5 fill-current" />{ui("Stop")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{ui("Stop and save the take")}<span className="ml-2 text-muted-foreground">{shortcutLabel('R')}</span></TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('gap-2 rounded-full', hasTakes ? 'h-10 px-5' : 'h-12 px-7 text-base')}
                  onClick={recorder.start}
                >
                  <span className="size-3 rounded-full bg-red-500" />
                  {hasTakes || pending.length ? ui("Record more") : ui("Record")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{hasTakes ? ui("Record a new take at the end") : ui("Start recording")}<span className="ml-2 text-muted-foreground">{shortcutLabel('R')}</span></TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {recorder.error && (
        <p role="alert" className="flex items-center justify-center gap-2 text-sm text-destructive">
          <TriangleAlert className="size-4" />{recorder.error}
          <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={ui("Dismiss")} onClick={() => recorder.setError(null)}><X className="size-3.5" /></button>
        </p>
      )}
      {!hasTakes && !recordingActive && !pending.length && editable && (
        <p className="mx-auto max-w-sm text-center text-sm text-muted-foreground">
          {ui("Record as many takes as you like; each one is added to the end. Mark parts to skip while listening, on the waveform, or in the transcript.")}
        </p>
      )}
    </div>
  )

  const transcript = (
    <aside className={cn('flex flex-col border-t', wide && 'lg:min-h-0 lg:w-[24rem] lg:border-t-0 lg:border-l xl:w-[28rem]')} aria-label={ui("Transcript")}>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">{ui("Transcript")}</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={ui("Copy transcript")} disabled={!lines.length} onClick={copyTranscript}>
              {copied ? <Check /> : <Copy />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{ui("Copy transcript, without skipped parts")}</TooltipContent>
        </Tooltip>
      </div>
      {!transcriptionEnabled && (
        <p className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{ui("Transcription is turned off by the administrator. Takes are still saved.")}</p>
      )}
      <RecordingTranscript
        timeline={timeline}
        lines={lines}
        activeKey={active?.key ?? null}
        playing={playing}
        editable={editable}
        transcriptionEnabled={transcriptionEnabled}
        recordingTake={recordingActive ? takeNumber : null}
        pending={pending}
        actions={actions}
      />
    </aside>
  )

  return (
    // Side by side, the player and the transcript scroll on their own; stacked, the page scrolls.
    <div ref={root} className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', wide && 'lg:flex-row lg:overflow-hidden')}>
      <div className={cn('min-w-0 shrink-0', wide ? 'p-4 sm:p-6 lg:flex-1 lg:shrink lg:overflow-y-auto' : 'p-4')}>
        {notice && (
          <div role="alert" className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" className="cursor-pointer" aria-label={ui("Dismiss")} onClick={() => setNotice(null)}><X className="size-3.5" /></button>
          </div>
        )}
        <div className="mx-auto max-w-3xl">{player}</div>
      </div>
      {transcript}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleting ? uit`Delete take ${deleting.index + 1}?` : ''}</DialogTitle>
            <DialogDescription>{ui("Its audio and transcript are deleted for good. The takes around it then play one after the other.")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{ui("Cancel")}</Button>
            <Button variant="destructive" onClick={confirmDelete}>{ui("Delete take")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
