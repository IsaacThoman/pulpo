import { Loader2, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDictationTime } from '@/lib/dictation'

const IDLE_LEVELS = Array.from({ length: 32 }, (_, index) => 0.16 + ((index * 7) % 5) * 0.04)

export function DictationRecorder({
  state,
  elapsedMs,
  levels,
  recordingLabel,
  transcribingLabel,
  cancelLabel,
  stopLabel,
  onCancel,
  onStop,
}: {
  state: 'recording' | 'transcribing'
  elapsedMs: number
  levels: number[]
  recordingLabel: string
  transcribingLabel: string
  cancelLabel: string
  stopLabel: string
  onCancel: () => void
  onStop: () => void
}) {
  const recording = state === 'recording'
  const visibleLevels = levels.length ? levels : IDLE_LEVELS

  return (
    <div className="animate-dictation-enter px-2.5 py-2.5" role="group" aria-label={recording ? recordingLabel : transcribingLabel}>
      <div className={cn(
        'relative flex h-14 items-center gap-2 overflow-hidden rounded-[1.15rem] border px-2 shadow-inner transition-colors duration-300',
        recording
          ? 'border-red-500/20 bg-gradient-to-r from-red-500/[0.09] via-red-500/[0.04] to-transparent dark:from-red-500/[0.14]'
          : 'border-primary/10 bg-muted/55',
      )}>
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/15" />

        <div className="flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
          {recording ? (
            <span className="relative flex size-3 items-center justify-center">
              <span className="absolute size-3 animate-ping rounded-full bg-red-500/30 motion-reduce:animate-none" />
              <span className="relative size-2 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.65)]" />
            </span>
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="relative flex h-8 min-w-0 flex-1 items-center gap-0.5 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 z-10 w-5 bg-gradient-to-r from-card/80 to-transparent" />
          {visibleLevels.map((level, index) => (
            <span
              key={index}
              className={cn(
                'h-full min-w-px flex-1 origin-center rounded-full transition-transform duration-75',
                recording ? 'bg-red-500/85' : 'animate-dictation-wave bg-muted-foreground/45',
              )}
              style={{
                transform: `scaleY(${recording ? Math.max(0.12, Math.min(level, 1)) : 0.28 + (index % 6) * 0.1})`,
                animationDelay: `${index * -45}ms`,
              }}
            />
          ))}
          <div className="absolute inset-y-0 right-0 z-10 w-5 bg-gradient-to-l from-card/80 to-transparent" />
        </div>

        <span className="w-11 shrink-0 text-right text-sm font-medium tabular-nums tracking-tight text-foreground/80" aria-hidden={!recording}>
          {recording ? formatDictationTime(elapsedMs) : ''}
        </span>

        <button
          type="button"
          onClick={onCancel}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
          aria-label={cancelLabel}
        >
          <X className="size-4" />
        </button>

        {recording && (
          <button
            type="button"
            onClick={onStop}
            className="group flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-red-500/15 text-red-500 transition-all hover:scale-105 hover:bg-red-500/25 active:scale-95"
            aria-label={stopLabel}
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_5px_16px_rgba(239,68,68,0.35)] transition-shadow group-hover:shadow-[0_5px_20px_rgba(239,68,68,0.5)]">
              <Square className="size-2.5 fill-current" />
            </span>
          </button>
        )}

        <span className="sr-only" aria-live="polite">{recording ? recordingLabel : transcribingLabel}</span>
      </div>
    </div>
  )
}
