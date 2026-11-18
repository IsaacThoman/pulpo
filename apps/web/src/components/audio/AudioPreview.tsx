import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, Captions, Loader2, Pause, Play, RotateCcw, RotateCw, TriangleAlert } from 'lucide-react'
import type { AudioTranscript } from '@pulpo/contracts'
import { SPEECH_SEEK_SECONDS, nextSpeechRate, speechRateLabel } from '@pulpo/client-core'
import { canTranscribeAudio } from '@pulpo/client-core/files'
import { ActionButton } from '@/components/chat/ActionButton'
import { CopyTextButton } from '@/components/chat/CopyTextButton'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import {
  activeSegmentIndex,
  audioClock,
  audioTranscriptQueryKey,
  fetchAudioTranscript,
  transcriptErrorMessage,
  type TranscriptSource,
} from './transcript'

/** After the reader scrolls the transcript, it stops following playback for this long. */
const MANUAL_SCROLL_HOLD_MS = 4000
/** Transcripts are billed, so keep them for reopening instead of transcribing again. */
const TRANSCRIPT_CACHE_MS = 7 * 24 * 60 * 60 * 1000

type PlaybackState = { time: number; duration: number; paused: boolean; rate: number; failed: boolean }

/** The element's playback state. Time follows animation frames while playing so the transcript keeps pace. */
function useAudioPlayback(audio: HTMLAudioElement | null, src: string) {
  const [state, setState] = useState<PlaybackState>({ time: 0, duration: 0, paused: true, rate: 1, failed: false })
  useEffect(() => {
    setState((current) => ({ ...current, time: 0, duration: 0, paused: true, failed: false }))
  }, [src])
  useEffect(() => {
    if (!audio) return
    let frame = 0
    const read = () => setState({
      time: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      paused: audio.paused,
      rate: audio.playbackRate,
      failed: Boolean(audio.error),
    })
    const tick = () => {
      read()
      frame = audio.paused ? 0 : requestAnimationFrame(tick)
    }
    const onPlay = () => { cancelAnimationFrame(frame); tick() }
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'pause', 'ended', 'ratechange', 'seeked', 'error', 'emptied'] as const
    for (const event of events) audio.addEventListener(event, read)
    audio.addEventListener('play', onPlay)
    read()
    return () => {
      cancelAnimationFrame(frame)
      for (const event of events) audio.removeEventListener(event, read)
      audio.removeEventListener('play', onPlay)
    }
  }, [audio])
  return state
}

function TranscriptView({
  transcript,
  time,
  playing,
  onSeek,
}: {
  transcript: AudioTranscript
  time: number
  playing: boolean
  onSeek: (seconds: number) => void
}) {
  const scroller = useRef<HTMLOListElement>(null)
  const manualScrollUntil = useRef(0)
  const active = activeSegmentIndex(transcript.segments, time)

  // Keep the spoken line in view while playing, unless the reader has just scrolled away.
  useEffect(() => {
    if (!playing || active === null || Date.now() < manualScrollUntil.current) return
    // Scroll only the transcript; scrollIntoView would also move the page or dialog around it.
    const list = scroller.current
    const line = list?.querySelector<HTMLElement>(`[data-segment="${active}"]`)
    if (!list || !line) return
    const visible = line.offsetTop >= list.scrollTop && line.offsetTop + line.offsetHeight <= list.scrollTop + list.clientHeight
    if (!visible) list.scrollTo?.({ top: Math.max(0, line.offsetTop - list.clientHeight / 3), behavior: 'smooth' })
  }, [active, playing])
  const holdFollowing = () => { manualScrollUntil.current = Date.now() + MANUAL_SCROLL_HOLD_MS }

  if (!transcript.segments.length) {
    return <p className="px-4 py-3 text-sm leading-6 whitespace-pre-wrap">{transcript.text}</p>
  }
  return (
    <ol
      ref={scroller}
      aria-label={ui("Transcript")}
      onWheel={holdFollowing}
      onTouchMove={holdFollowing}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
    >
      {transcript.segments.map((segment, index) => (
        <li key={`${index}:${segment.start}`}>
          <button
            type="button"
            data-segment={index}
            aria-current={index === active ? 'true' : undefined}
            aria-label={uit`Play from ${audioClock(segment.start)}: ${segment.text}`}
            onClick={() => onSeek(segment.start)}
            className={cn(
              'group flex w-full cursor-pointer gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm leading-6 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:outline-none',
              index === active ? 'bg-accent text-foreground' : active !== null && index > active ? 'text-muted-foreground' : 'text-foreground/85',
            )}
          >
            <span className={cn(
              'w-12 shrink-0 pt-px text-right text-xs leading-6 text-muted-foreground tabular-nums transition-colors group-hover:text-foreground',
              index === active && 'font-medium text-fuchsia-600 dark:text-fuchsia-400',
            )}>
              {audioClock(segment.start)}
            </span>
            <span className="min-w-0 flex-1">{segment.text}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function TranscriptPanel({
  transcript,
  pending,
  error,
  time,
  playing,
  onRetry,
  onSeek,
}: {
  transcript: AudioTranscript | undefined
  pending: boolean
  error: unknown
  time: number
  playing: boolean
  onRetry: () => void
  onSeek: (seconds: number) => void
}) {
  return (
    <section aria-label={ui("Transcript")} className="flex min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-card shadow-xs" data-testid="audio-transcript">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Captions className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-medium">{ui("Transcript")}</h2>
        {transcript && <CopyTextButton text={transcript.text} />}
      </header>
      {transcript && <TranscriptView transcript={transcript} time={time} playing={playing} onSeek={onSeek} />}
      {!transcript && pending && (
        <div role="status" className="flex flex-col gap-3 p-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {ui("Transcribing…")}</p>
          {[92, 78, 85, 60].map((width) => (
            <div key={width} className="h-3 animate-pulse rounded-full bg-muted motion-reduce:animate-none" style={{ width: `${width}%` }} />
          ))}
        </div>
      )}
      {!transcript && !pending && error != null && (
        <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
          <TriangleAlert className="size-5 text-amber-500" />
          <p className="max-w-sm text-sm text-muted-foreground">{transcriptErrorMessage(error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>{ui("Try again")}</Button>
        </div>
      )}
    </section>
  )
}

/**
 * An audio file's player, with a transcript that follows playback. Transcribing is offered when
 * dictation is enabled and the file is stored (`source`) in a format and size Groq accepts.
 */
export function AudioPreview({
  src,
  name,
  mimeType,
  sizeBytes,
  source,
}: {
  src: string
  name: string
  mimeType: string | null | undefined
  sizeBytes: number
  source: TranscriptSource | null
}) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const playback = useAudioPlayback(audio, src)
  const [scrub, setScrub] = useState<number | null>(null)
  const userId = useAuth((state) => state.user?.id)
  const dictationEnabled = useAuth((state) => state.dictationEnabled)
  const transcribable = Boolean(source && userId && dictationEnabled && canTranscribeAudio(name, mimeType, sizeBytes))
  const [requested, setRequested] = useState(false)
  const [shown, setShown] = useState(true)
  const transcriptQuery = useQuery({
    queryKey: audioTranscriptQueryKey(userId, source ?? { kind: 'file', id: '' }),
    queryFn: () => fetchAudioTranscript(source!),
    enabled: transcribable && requested,
    staleTime: Infinity,
    gcTime: TRANSCRIPT_CACHE_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const transcript = transcribable ? transcriptQuery.data : undefined
  const transcriptOpen = transcribable && shown && (requested || transcript !== undefined)

  const seekTo = useCallback((seconds: number, play = false) => {
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds))
    if (play && audio.paused) void audio.play().catch(() => undefined)
  }, [audio])
  const togglePlay = () => {
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => undefined)
    else audio.pause()
  }
  const toggleTranscript = () => {
    if (transcriptOpen) { setShown(false); return }
    setShown(true)
    if (!requested) setRequested(true)
    else if (!transcript && !transcriptQuery.isFetching) void transcriptQuery.refetch()
  }

  const duration = playback.duration
  const time = scrub ?? playback.time
  const ended = duration > 0 && playback.paused && playback.time >= duration - 0.05
  const disabled = playback.failed || !duration

  return (
    <div
      className={cn('flex size-full min-h-0 flex-col items-center gap-3 overflow-hidden bg-gradient-to-br from-fuchsia-500/10 via-background to-violet-500/10 p-4 sm:p-6', !transcriptOpen && 'justify-center')}
      data-preview-kind="audio"
    >
      <audio ref={setAudio} src={src} preload="metadata" aria-label={uit`Audio preview of ${name}`} className="hidden" />
      <section aria-label={ui("Audio player")} className="w-full max-w-2xl shrink-0 rounded-2xl border bg-card p-4 shadow-xs">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white shadow-xs">
            <AudioLines className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {playback.failed ? ui("This audio can’t be played here. Download it to listen.") : duration ? audioClock(duration) : ui("Loading audio…")}
            </p>
          </div>
        </div>
        <Slider
          aria-label={ui("Playback position")}
          className="mt-4"
          min={0}
          max={duration || 1}
          step={0.1}
          value={[Math.min(time, duration || 1)]}
          disabled={disabled}
          onValueChange={([value]) => setScrub(value ?? 0)}
          onValueCommit={([value]) => { seekTo(value ?? 0); setScrub(null) }}
        />
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{audioClock(time)}</span>
          <span>{duration ? `-${audioClock(Math.max(0, duration - time))}` : '0:00'}</span>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex justify-start">
            <button
              type="button"
              title={ui('Playback speed {{rate}}', { rate: speechRateLabel(playback.rate) })}
              aria-label={ui('Playback speed {{rate}}', { rate: speechRateLabel(playback.rate) })}
              disabled={disabled}
              onClick={() => { if (audio) audio.playbackRate = nextSpeechRate(audio.playbackRate) }}
              className="flex h-8 min-w-10 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              {speechRateLabel(playback.rate)}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <ActionButton label={ui('Back {{seconds}} seconds', { seconds: SPEECH_SEEK_SECONDS })} disabled={disabled} onClick={() => seekTo(playback.time - SPEECH_SEEK_SECONDS)}>
              <RotateCcw className="size-4" />
            </ActionButton>
            <button
              type="button"
              aria-label={ui(ended ? 'Replay' : playback.paused ? 'Play' : 'Pause')}
              title={ui(ended ? 'Replay' : playback.paused ? 'Play' : 'Pause')}
              disabled={disabled}
              onClick={togglePlay}
              className="mx-1 flex size-11 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 disabled:cursor-default disabled:opacity-30 disabled:hover:scale-100 motion-reduce:transition-none"
            >
              {playback.paused ? <Play className="size-5 translate-x-px fill-current" /> : <Pause className="size-5 fill-current" />}
            </button>
            <ActionButton label={ui('Forward {{seconds}} seconds', { seconds: SPEECH_SEEK_SECONDS })} disabled={disabled} onClick={() => seekTo(playback.time + SPEECH_SEEK_SECONDS)}>
              <RotateCw className="size-4" />
            </ActionButton>
          </div>
          <div className="flex justify-end">
            {transcribable && (
              <Button
                type="button"
                variant={transcriptOpen ? 'secondary' : 'outline'}
                size="sm"
                className="rounded-full"
                aria-pressed={transcriptOpen}
                aria-label={ui(transcriptOpen ? 'Hide transcript' : transcript ? 'Show transcript' : 'Transcribe')}
                title={ui(transcriptOpen ? 'Hide transcript' : transcript ? 'Show transcript' : 'Transcribe')}
                onClick={toggleTranscript}
              >
                {transcriptQuery.isFetching ? <Loader2 className="animate-spin" /> : <Captions />}
                <span className="hidden sm:inline">{ui(transcript || transcriptQuery.isFetching ? 'Transcript' : 'Transcribe')}</span>
              </Button>
            )}
          </div>
        </div>
      </section>
      {transcriptOpen && (
        <TranscriptPanel
          transcript={transcript}
          pending={transcriptQuery.isFetching}
          error={transcriptQuery.error}
          time={playback.time}
          playing={!playback.paused}
          onRetry={() => void transcriptQuery.refetch()}
          onSeek={(seconds) => seekTo(seconds, true)}
        />
      )}
    </div>
  )
}
