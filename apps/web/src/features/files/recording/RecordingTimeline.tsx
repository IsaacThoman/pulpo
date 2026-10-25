import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { RecordingRange } from '@pulpo/contracts'
import { formatRecordingTime, skipAt, waveformBars, type RecordingTimeline as Timeline } from '@pulpo/client-core/files'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import './recording.css'

const BAR_PITCH = 3
const BAR_WIDTH = 2
const HEIGHT = 96
/** Pointer travel that turns a click into a drag that selects. */
const DRAG_THRESHOLD_PX = 4
const KEY_STEP_MS = 5_000

function useWidth<T extends HTMLElement>() {
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

/** The bars themselves, drawn once per change to the recording rather than on every frame. */
const Bars = memo(function Bars({ bars, className }: { bars: number[]; className: string }) {
  return (
    <svg aria-hidden className={cn('absolute inset-0 size-full', className)} preserveAspectRatio="none" viewBox={`0 0 ${bars.length * BAR_PITCH} ${HEIGHT}`}>
      {bars.map((level, index) => {
        const height = Math.max(2, level * (HEIGHT - 8))
        return <rect key={index} x={index * BAR_PITCH} y={(HEIGHT - height) / 2} width={BAR_WIDTH} height={height} rx={1} fill="currentColor" />
      })}
    </svg>
  )
})

/**
 * The whole recording as one waveform: click to move there, drag to select a part. Skipped parts
 * are hatched, takes are divided by thin lines, and what has played is drawn darker.
 */
export function RecordingTimeline({ timeline, positionMs, selection, markStartMs, disabled, onSeek, onSelect }: {
  timeline: Timeline
  positionMs: number
  selection: RecordingRange | null
  /** Where a skip being marked during playback starts. */
  markStartMs: number | null
  disabled?: boolean
  onSeek: (ms: number) => void
  onSelect: (range: RecordingRange | null) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  const [dragging, setDragging] = useState<RecordingRange | null>(null)
  const drag = useRef<{ startX: number; startMs: number; moved: boolean } | null>(null)
  const { durationMs } = timeline
  const count = Math.max(1, Math.floor(width / BAR_PITCH))
  const bars = waveformBars(timeline, count)
  const percent = (ms: number) => durationMs ? `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%` : '0%'
  const span = (range: RecordingRange) => ({ left: percent(range.startMs), width: percent(range.endMs - range.startMs) })

  const timeAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || !box.width) return 0
    return Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * durationMs)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || !durationMs) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startMs: timeAt(event.clientX), moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = timeAt(event.clientX)
    setHoverMs(at)
    const current = drag.current
    if (!current) return
    if (!current.moved && Math.abs(event.clientX - current.startX) < DRAG_THRESHOLD_PX) return
    current.moved = true
    setDragging({ startMs: Math.min(current.startMs, at), endMs: Math.max(current.startMs, at) })
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    drag.current = null
    if (!current) return
    const at = timeAt(event.clientX)
    setDragging(null)
    if (current.moved) {
      const range = { startMs: Math.min(current.startMs, at), endMs: Math.max(current.startMs, at) }
      onSelect(range.endMs - range.startMs >= 100 ? range : null)
      return
    }
    // A click on a skipped part selects it, so it can be kept; anywhere else just moves there.
    const skip = skipAt(timeline.skips, at)
    onSelect(skip)
    onSeek(skip ? skip.startMs : at)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step = event.shiftKey ? KEY_STEP_MS * 3 : KEY_STEP_MS
    const target = event.key === 'ArrowLeft' ? positionMs - step
      : event.key === 'ArrowRight' ? positionMs + step
        : event.key === 'Home' ? 0
          : event.key === 'End' ? durationMs
            : null
    if (target === null) return
    event.preventDefault()
    // Space and the arrows also work on the page; handled here, they must not run twice.
    event.stopPropagation()
    onSeek(Math.max(0, Math.min(durationMs, target)))
  }

  const shown = dragging ?? selection
  const played = durationMs ? Math.min(1, positionMs / durationMs) : 0
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ui("Recording position")}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(positionMs / 1000)}
      aria-valuetext={uit`${formatRecordingTime(positionMs)} of ${formatRecordingTime(durationMs)}`}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; setDragging(null) }}
      onPointerLeave={() => setHoverMs(null)}
      onKeyDown={onKeyDown}
      className={cn(
        'relative w-full touch-none select-none rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer',
      )}
      style={{ height: HEIGHT }}
      data-testid="recording-timeline"
    >
      <Bars bars={bars} className="text-muted-foreground/35" />
      {/* The same bars, darker, cut off at the playhead. */}
      <div aria-hidden className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - played) * 100}% 0 0)` }}>
        <Bars bars={bars} className="text-foreground/80" />
      </div>
      {timeline.skips.map((skip) => (
        <div
          key={`${skip.startMs}-${skip.endMs}`}
          aria-hidden
          className="pulpo-recording-skip absolute inset-y-0 rounded-sm border-x border-amber-500/50 bg-amber-500/10"
          style={span(skip)}
          data-testid="recording-skip"
        />
      ))}
      {timeline.clips.slice(1).map((entry) => (
        <div key={entry.clip.id} aria-hidden className="absolute inset-y-1 w-px bg-border" style={{ left: percent(entry.startMs) }} />
      ))}
      {shown && (
        <div aria-hidden className="absolute inset-y-0 rounded-sm border-x-2 border-primary bg-primary/10" style={span(shown)} data-testid="recording-selection" />
      )}
      {markStartMs !== null && (
        <div aria-hidden className="absolute inset-y-0 border-l-2 border-dashed border-amber-500 bg-amber-500/10" style={{ left: percent(markStartMs), width: percent(Math.max(0, positionMs - markStartMs)) }} />
      )}
      {hoverMs !== null && !disabled && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: percent(hoverMs) }}>
          <span className="absolute -top-6 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 text-[11px] tabular-nums text-popover-foreground shadow-sm ring-1 ring-border">
            {formatRecordingTime(hoverMs)}
          </span>
        </div>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: percent(positionMs) }}>
        <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-primary" />
      </div>
    </div>
  )
}
