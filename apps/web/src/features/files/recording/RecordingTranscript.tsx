import { useEffect, useRef } from 'react'
import { AlertCircle, Download, EyeOff, Eye, Loader2, MoreHorizontal, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { formatRecordingTime, type RecordingTimeline, type TimelineClip, type TranscriptLine } from '@pulpo/client-core/files'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import type { PendingTake } from './take-uploads'

/** After the listener scrolls the transcript, it stops following playback for this long. */
const MANUAL_SCROLL_MS = 4_000

function takeTime(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString(activeLocale(), sameDay ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export interface TranscriptActions {
  seek: (ms: number) => void
  setSkipped: (line: TranscriptLine, skipped: boolean) => void
  retryTranscript: (clipId: string) => void
  downloadTake: (clipId: string) => void
  deleteTake: (entry: TimelineClip, index: number) => void
  retryUpload: (key: string) => void
  discardUpload: (key: string) => void
}

function TakeStatus({ entry, editable, onRetry }: { entry: TimelineClip; editable: boolean; onRetry: (() => void) | null }) {
  const { status, error } = entry.clip.transcript
  if (status === 'pending') {
    return <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{ui("Transcribing…")}</p>
  }
  if (status === 'unavailable') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <span className="min-w-0 flex-1">{ui("Not transcribed: transcription was turned off.")}</span>
        {editable && onRetry && <Button size="sm" variant="ghost" onClick={onRetry}><RotateCcw />{ui("Transcribe")}</Button>}
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{error ?? ui("The transcript could not be made.")}</span>
        {editable && onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RotateCcw />{ui("Try again")}</Button>}
      </div>
    )
  }
  return null
}

/**
 * The transcript beside the player: one group per take, a line per timed segment. Clicking a line
 * plays from there; the line being heard is highlighted and kept in view while playing.
 */
export function RecordingTranscript({ timeline, lines, activeKey, playing, editable, transcriptionEnabled, recordingTake, pending, actions }: {
  timeline: RecordingTimeline
  lines: TranscriptLine[]
  activeKey: string | null
  playing: boolean
  editable: boolean
  /** Whether takes can be transcribed again now. */
  transcriptionEnabled: boolean
  /** The number of the take being recorded, if one is. */
  recordingTake: number | null
  pending: PendingTake[]
  actions: TranscriptActions
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrolledAt = useRef(0)

  useEffect(() => {
    if (!playing || !activeKey || Date.now() - scrolledAt.current < MANUAL_SCROLL_MS) return
    const line = scroller.current?.querySelector<HTMLElement>(`[data-line="${CSS.escape(activeKey)}"]`)
    line?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeKey, playing])

  const byClip = new Map<string, TranscriptLine[]>()
  for (const line of lines) byClip.set(line.clipId, [...byClip.get(line.clipId) ?? [], line])
  const takes = timeline.clips.length

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 lg:overflow-y-auto lg:overscroll-contain"
      onWheel={() => { scrolledAt.current = Date.now() }}
      onTouchMove={() => { scrolledAt.current = Date.now() }}
      data-testid="recording-transcript"
    >
      {!takes && !pending.length && recordingTake === null && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{ui("The transcript of each take appears here once it's recorded.")}</p>
      )}
      {timeline.clips.map((entry, index) => {
        const own = byClip.get(entry.clip.id) ?? []
        return (
          <section key={entry.clip.id} aria-label={uit`Take ${index + 1}`} className="border-b py-1 last:border-b-0">
            <header className="group/take flex items-center gap-1 px-3 pt-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{uit`Take ${index + 1}`}</span>
              <span>·</span>
              <span>{takeTime(entry.clip.recordedAt)}</span>
              <span>·</span>
              <span className="tabular-nums">{formatRecordingTime(entry.clip.durationMs)}</span>
              <span className="flex-1" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-6 opacity-60 group-hover/take:opacity-100" aria-label={uit`Take ${index + 1} actions`}><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => actions.seek(entry.startMs)}><Play />{ui("Play from the start of this take")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.downloadTake(entry.clip.id)}><Download />{ui("Download audio")}</DropdownMenuItem>
                  {editable && transcriptionEnabled && (entry.clip.transcript.status === 'failed' || entry.clip.transcript.status === 'unavailable') && (
                    <DropdownMenuItem onSelect={() => actions.retryTranscript(entry.clip.id)}><RotateCcw />{ui("Transcribe again")}</DropdownMenuItem>
                  )}
                  {editable && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteTake(entry, index)}><Trash2 />{ui("Delete take")}</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            <TakeStatus entry={entry} editable={editable} onRetry={transcriptionEnabled ? () => actions.retryTranscript(entry.clip.id) : null} />
            {entry.clip.transcript.status === 'ready' && !own.length && (
              <p className="px-3 py-2 text-sm text-muted-foreground">{ui("No speech in this take.")}</p>
            )}
            <ol className="py-0.5">
              {own.map((line) => {
                const active = line.key === activeKey
                return (
                  <li
                    key={line.key}
                    data-line={line.key}
                    className={cn('group/line relative flex gap-2 rounded-md px-3 py-1 text-sm', active && 'bg-accent')}
                  >
                    <button
                      type="button"
                      onClick={() => actions.seek(line.startMs)}
                      className="mt-px shrink-0 cursor-pointer text-xs tabular-nums text-muted-foreground hover:text-foreground"
                      aria-label={uit`Play from ${formatRecordingTime(line.startMs)}`}
                    >
                      {formatRecordingTime(line.startMs)}
                    </button>
                    <span
                      onClick={() => actions.seek(line.startMs)}
                      className={cn('min-w-0 flex-1 cursor-pointer leading-relaxed', line.skipped && 'text-muted-foreground/70 line-through decoration-muted-foreground/50')}
                    >
                      {line.text}
                    </span>
                    {editable && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => actions.setSkipped(line, !line.skipped)}
                            className="invisible mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:visible group-hover/line:visible"
                            aria-label={line.skipped ? ui("Don't skip this part") : ui("Skip this part")}
                          >
                            {line.skipped ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">{line.skipped ? ui("Don't skip this part") : ui("Skip this part")}</TooltipContent>
                      </Tooltip>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
      {pending.map((take, index) => (
        <section key={take.key} className="border-b px-3 py-2 last:border-b-0">
          <header className="text-xs font-medium">{uit`Take ${takes + index + 1}`}</header>
          {take.status === 'failed' ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{take.error ?? ui("This take couldn't be saved.")}</span>
              <Button size="sm" variant="outline" onClick={() => actions.retryUpload(take.key)}><RotateCcw />{ui("Retry")}</Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={ui("Discard take")} onClick={() => actions.discardUpload(take.key)}><X /></Button>
                </TooltipTrigger>
                <TooltipContent>{ui("Discard take")}</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{ui("Saving take…")}</p>
          )}
        </section>
      ))}
      {recordingTake !== null && (
        <section className="px-3 py-2">
          <header className="flex items-center gap-1.5 text-xs font-medium">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            {uit`Recording take ${recordingTake}`}
          </header>
          <p className="mt-1 text-sm text-muted-foreground">{ui("Its transcript appears when you stop.")}</p>
        </section>
      )}
    </div>
  )
}
