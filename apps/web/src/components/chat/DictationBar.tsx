import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import {
  DICTATION_LEVEL_INTERVAL_MS,
  DICTATION_MAX_SECONDS,
  DICTATION_WAVEFORM_BAR_PITCH,
  DICTATION_WAVEFORM_BAR_WIDTH,
  dictationNearsLimit,
  dictationWaveformBarCount,
  formatDictationElapsed,
} from '@pulpo/client-core'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useMicrophoneLevels, type DictationPhase } from './use-microphone-levels'
import { useStalled } from './use-stalled'

type ActivePhase = Exclude<DictationPhase, 'idle'>

const BAR_HEIGHT = 24
const MIN_BAR_HEIGHT = 2

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * A new sample moves every bar one slot left. Starting the row one pitch to the right and
 * sliding it back over one sampling interval turns those steps into a smooth scroll.
 */
function useScrollOnNewSample(levels: readonly number[]) {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef(levels)
  const animation = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    if (previous.current === levels) return
    previous.current = levels
    const row = ref.current
    if (!row || typeof row.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    animation.current?.cancel()
    animation.current = row.animate(
      [{ transform: `translateX(${DICTATION_WAVEFORM_BAR_PITCH}px)` }, { transform: 'translateX(0)' }],
      { duration: DICTATION_LEVEL_INTERVAL_MS, easing: 'linear' },
    )
  }, [levels])
  useEffect(() => () => animation.current?.cancel(), [])
  return ref
}

/** Scrolling loudness history: bars glide left and the newest sample slides in from the right. */
export function DictationWaveform({ levels }: { levels: readonly number[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const rowRef = useScrollOnNewSample(levels)
  const count = dictationWaveformBarCount(width, levels.length)
  return (
    <div ref={ref} aria-hidden className="relative min-w-0 flex-1 overflow-hidden" style={{ height: BAR_HEIGHT }} data-testid="dictation-waveform">
      {/* Right-aligned and wider than the track, so the oldest bar hides past the left edge. */}
      <div
        ref={rowRef}
        className="absolute inset-y-0 right-0 flex items-center"
        style={{ gap: DICTATION_WAVEFORM_BAR_PITCH - DICTATION_WAVEFORM_BAR_WIDTH }}
        data-testid="dictation-waveform-row"
      >
        {levels.slice(levels.length - count).map((level, index) => (
          <span
            key={index}
            data-level={level}
            className="shrink-0 rounded-full bg-foreground"
            style={{
              width: DICTATION_WAVEFORM_BAR_WIDTH,
              height: BAR_HEIGHT,
              opacity: 0.22 + level * 0.78,
              transform: `scaleY(${(MIN_BAR_HEIGHT + level * (BAR_HEIGHT - MIN_BAR_HEIGHT)) / BAR_HEIGHT})`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function useElapsedSeconds(startedAt: number | null): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (startedAt === null) return undefined
    const tick = () => setSeconds(Math.min(DICTATION_MAX_SECONDS, Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return seconds
}

/** Keeps showing the last active phase while the bar animates away after dictation ends. */
function useDisplayedPhase(phase: DictationPhase): ActivePhase {
  const [displayed, setDisplayed] = useState<ActivePhase>(phase === 'idle' ? 'preparing' : phase)
  if (phase !== 'idle' && phase !== displayed) setDisplayed(phase)
  return displayed
}

/** Replaces the composer toolbar while dictating: cancel, live loudness and timer, and finish. */
export function DictationBar({ phase, stream, startedAt, onCancel, onConfirm }: {
  phase: DictationPhase
  stream: MediaStream | null
  startedAt: number | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const displayed = useDisplayedPhase(phase)
  const recording = displayed === 'recording'
  const levels = useMicrophoneLevels(recording ? stream : null)
  const elapsedSeconds = useElapsedSeconds(recording ? startedAt : null)
  // Opening the microphone keeps the still waveform unless the wait passes a second.
  const stalled = useStalled(phase === 'preparing' ? phase : null)
  const showsWaveform = recording || (displayed === 'preparing' && !stalled)
  const seconds = displayed === 'preparing' ? 0 : elapsedSeconds
  const elapsed = formatDictationElapsed(seconds)
  const label = displayed === 'recording' ? ui('Recording {{elapsed}}', { elapsed })
    : displayed === 'transcribing' ? t('chat.transcribing')
      : ui('Waiting for microphone…')
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onCancel}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={ui('Cancel dictation')}
          >
            <X className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{ui('Cancel dictation')}</TooltipContent>
      </Tooltip>
      <div role="status" aria-live={recording ? 'off' : 'polite'} aria-label={label} className="relative h-8 min-w-0 flex-1">
        <div className={cn('absolute inset-0 flex items-center gap-2.5 px-1 transition-opacity duration-200 motion-reduce:transition-none', showsWaveform ? 'opacity-100' : 'opacity-0')} data-testid="dictation-waveform-layer">
          <DictationWaveform levels={levels} />
          <span className={cn('shrink-0 text-xs tabular-nums', dictationNearsLimit(seconds) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')} data-testid="dictation-elapsed">
            {elapsed}
          </span>
        </div>
        <div className={cn('absolute inset-0 flex items-center justify-center px-2 text-sm text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none', showsWaveform ? 'opacity-0' : 'opacity-100')} data-testid="dictation-label-layer">
          <span className="truncate">{label}</span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            className="rounded-full"
            onClick={onConfirm}
            disabled={!recording}
            aria-label={ui('Finish dictation')}
          >
            {showsWaveform ? <Check className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{ui('Finish dictation')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
