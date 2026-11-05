import { useEffect, useState, useSyncExternalStore } from 'react'
import { Download, FolderDown, FolderInput, Loader2, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import { SPEECH_SEEK_SECONDS, nextSpeechRate, speechRateLabel, speechTimeLabel, type SpeechPlaybackState, type SpeechProgress } from '@pulpo/client-core'
import { speechAudioBlob } from './playback'
import { speechPlayback } from './state'
import { ui } from '@/i18n/ui'
import { ActionButton } from '@/components/chat/ActionButton'
import { SaveToFilesDialog } from '@/components/chat/SaveToFiles'
import { saveContentToFiles, useCanSaveToFiles, useSavedToFilesToast } from '@/components/chat/use-save-to-files'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useFileToasts } from '@/features/files/browser/toasts'
import { downloadBlob } from '@/lib/code-download'
import { cn } from '@/lib/utils'

// Audio time is not observable through the playback store, so poll while visible and
// refresh immediately whenever the playback state changes (a new chunk, pause, speed).
function useSpeechProgress(active: boolean, state: SpeechPlaybackState) {
  const [progress, setProgress] = useState<SpeechProgress | null>(null)
  useEffect(() => {
    if (!active) { setProgress(null); return }
    const refresh = () => setProgress(speechPlayback.progress())
    refresh()
    const timer = window.setInterval(refresh, 250)
    return () => window.clearInterval(timer)
  }, [active, state])
  return progress
}

/**
 * A progress bar that can be scrubbed. An invisible native range input on top keeps keyboard
 * and screen reader support; dragging previews the time and seeks on release. The lighter band
 * is generated audio, the furthest a seek can reach while later chunks are still generating.
 */
function SpeechScrubber({ progress }: { progress: SpeechProgress | null }) {
  const [drag, setDrag] = useState<number | null>(null)
  const total = progress?.total ?? 0
  const elapsed = drag ?? progress?.elapsed ?? 0
  const played = total ? Math.min(1, elapsed / total) : 0
  const buffered = total ? Math.min(1, (progress?.buffered ?? 0) / total) : 0
  const commit = () => { if (drag !== null) speechPlayback.seekTo(drag); setDrag(null) }
  return (
    <>
      <div className="group/scrub relative mx-1.5 flex h-5 w-20 shrink items-center sm:w-28">
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 bg-foreground/15" style={{ width: `${buffered * 100}%` }} />
          <div className={cn('absolute inset-y-0 left-0 rounded-full bg-foreground/50', drag === null && 'transition-[width] duration-200 ease-linear motion-reduce:transition-none')} style={{ width: `${played * 100}%` }} />
        </div>
        <div aria-hidden="true" className={cn('pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground opacity-0 transition-opacity group-hover/scrub:opacity-100 group-focus-within/scrub:opacity-100', drag !== null && 'opacity-100')} style={{ left: `${played * 100}%` }} />
        <input
          type="range"
          aria-label={ui('Reading position')}
          aria-valuetext={speechTimeLabel(progress && { ...progress, elapsed })}
          min={0}
          max={total || 1}
          step={1}
          value={elapsed}
          disabled={!total}
          onChange={event => setDrag(Math.min(Number(event.target.value), progress?.buffered ?? 0))}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
        />
      </div>
      <span className="shrink-0 tabular-nums">{speechTimeLabel(progress && { ...progress, elapsed })}</span>
    </>
  )
}

/**
 * Downloads the message's speech, or saves it to Files. Audio not yet generated is generated
 * first, in order, while playback carries on; the player keeps it for replay.
 */
function SpeechSaveMenu({ ready }: { ready: boolean }) {
  const canSave = useCanSaveToFiles()
  const saved = useSavedToFilesToast()
  const [preparing, setPreparing] = useState(false)
  const [picking, setPicking] = useState<{ blob: Blob; name: string } | null>(null)
  const prepare = async (then: (audio: { blob: Blob; name: string }) => void) => {
    setPreparing(true)
    try { then(await speechAudioBlob()) }
    catch (error) { useFileToasts.getState().show({ message: ui(error instanceof Error ? error.message : 'Speech generation failed'), tone: 'error' }) }
    finally { setPreparing(false) }
  }
  const download = () => void prepare(({ blob, name }) => downloadBlob(blob, name))
  const icon = preparing ? <Loader2 className="size-3.5 animate-spin" /> : canSave ? <FolderDown className="size-3.5" /> : <Download className="size-3.5" />
  if (!canSave) return <ActionButton label={ui(preparing ? 'Preparing audio…' : 'Download audio')} disabled={!ready || preparing} onClick={download}>{icon}</ActionButton>
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ActionButton label={ui(preparing ? 'Preparing audio…' : 'Save audio')} disabled={!ready || preparing}>{icon}</ActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={download}><Download /> {ui('Download')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void prepare(setPicking)}><FolderInput /> {ui('Save to Files…')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveToFilesDialog name={picking?.name ?? ''} save={input => saveContentToFiles(picking!.blob, input)} open={picking !== null} onOpenChange={open => { if (!open) setPicking(null) }} onSaved={saved} />
    </>
  )
}

/**
 * Controls beneath a message's Read aloud button. They stay after the message ends so it
 * can be replayed or rewound from its generated audio, until closed or another read starts.
 */
export function SpeechPlayer({ messageKey }: { messageKey: string }) {
  const state = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const visible = state.key === messageKey
  const progress = useSpeechProgress(visible, state)
  if (!visible) return null
  const loading = state.phase === 'loading'
  const ended = state.phase === 'ended'
  return (
    <section aria-label={ui('Read aloud controls')} className="inline-flex h-8 w-fit max-w-full items-center gap-0.5 rounded-lg border bg-card px-0.5 text-xs text-muted-foreground shadow-xs">
      <ActionButton label={ui('Back {{seconds}} seconds', { seconds: SPEECH_SEEK_SECONDS })} disabled={loading} onClick={() => speechPlayback.seekBy(-SPEECH_SEEK_SECONDS)}>
        <RotateCcw className="size-3.5" />
      </ActionButton>
      <ActionButton label={ui(ended ? 'Replay' : state.paused ? 'Resume reading' : 'Pause reading')} aria-pressed={!ended && state.paused} onClick={speechPlayback.togglePause}>
        {ended || state.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </ActionButton>
      <ActionButton label={ui('Forward {{seconds}} seconds', { seconds: SPEECH_SEEK_SECONDS })} disabled={loading || ended} onClick={() => speechPlayback.seekBy(SPEECH_SEEK_SECONDS)}>
        <RotateCw className="size-3.5" />
      </ActionButton>
      <SpeechScrubber progress={progress} />
      <button
        type="button"
        title={ui('Playback speed {{rate}}', { rate: speechRateLabel(state.rate) })}
        aria-label={ui('Playback speed {{rate}}', { rate: speechRateLabel(state.rate) })}
        onClick={() => speechPlayback.setRate(nextSpeechRate(state.rate))}
        className="ml-1 flex h-7 min-w-9 cursor-pointer items-center justify-center rounded-md px-1.5 font-medium tabular-nums transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2"
      >
        {speechRateLabel(state.rate)}
      </button>
      <SpeechSaveMenu ready={Boolean(progress?.total)} />
      <ActionButton label={ui('Close player')} onClick={speechPlayback.stop}>
        <X className="size-3.5" />
      </ActionButton>
    </section>
  )
}
