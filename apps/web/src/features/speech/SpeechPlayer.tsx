import { useEffect, useState, useSyncExternalStore } from 'react'
import { Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import { SPEECH_SEEK_SECONDS, nextSpeechRate, speechClock, speechRateLabel, type SpeechPlaybackState, type SpeechProgress } from '@pulpo/client-core'
import { speechPlayback } from './state'
import { ui } from '@/i18n/ui'
import { ActionButton } from '@/components/chat/ActionButton'

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

/** Controls for message read-aloud, docked above the composer while a message is being read. */
export function SpeechPlayer() {
  const state = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const visible = state.key !== null && !state.key.startsWith('preview:')
  const progress = useSpeechProgress(visible, state)
  if (!visible) return null
  const loading = state.phase === 'loading'
  const status = state.paused ? 'Paused' : loading ? 'Preparing speech…' : 'Reading aloud'
  const percent = Math.round((progress?.fraction ?? 0) * 100)
  return (
    <section aria-label={ui('Read aloud controls')} className="-mb-3 flex items-center gap-0.5 rounded-t-2xl border border-b-0 bg-card px-2 pt-1.5 pb-4 shadow-sm">
      <ActionButton label={ui('Back {{seconds}} seconds', { seconds: SPEECH_SEEK_SECONDS })} disabled={loading} onClick={() => speechPlayback.seekBy(-SPEECH_SEEK_SECONDS)}>
        <RotateCcw className="size-3.5" />
      </ActionButton>
      <ActionButton label={ui(state.paused ? 'Resume reading' : 'Pause reading')} aria-pressed={state.paused} onClick={speechPlayback.togglePause}>
        {state.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </ActionButton>
      <ActionButton label={ui('Forward {{seconds}} seconds', { seconds: SPEECH_SEEK_SECONDS })} disabled={loading} onClick={() => speechPlayback.seekBy(SPEECH_SEEK_SECONDS)}>
        <RotateCw className="size-3.5" />
      </ActionButton>
      <div className="min-w-0 flex-1 px-2">
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span role="status" className="truncate">{ui(status)}</span>
          <span className="shrink-0 tabular-nums">
            {speechClock(progress?.elapsed ?? 0)}{progress?.total ? ` / ${speechClock(progress.total)}` : ''}
          </span>
        </div>
        <div role="progressbar" aria-label={ui('Reading progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground/60 transition-[width] duration-200 ease-linear motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <button
        type="button"
        title={ui('Playback speed')}
        aria-label={ui('Playback speed {{rate}}', { rate: speechRateLabel(state.rate) })}
        onClick={() => speechPlayback.setRate(nextSpeechRate(state.rate))}
        className="flex h-7 min-w-9 cursor-pointer items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2"
      >
        {speechRateLabel(state.rate)}
      </button>
      <ActionButton label={ui('Stop reading')} onClick={speechPlayback.stop}>
        <X className="size-3.5" />
      </ActionButton>
    </section>
  )
}
