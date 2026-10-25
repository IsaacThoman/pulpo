import type { RecordingClip, RecordingRange, RecordingSkipUpdate } from '@pulpo/contracts'
import { RECORDING_LEVELS_PER_SECOND } from '@pulpo/contracts'
import { normalizeDictationDecibels } from '../dictation.js'

/**
 * A recording's takes laid end to end. Times here are milliseconds from the start of the whole
 * recording; skips and transcript segments are stored per take and converted with these.
 */
export interface RecordingTimeline {
  clips: TimelineClip[]
  durationMs: number
  /** Skipped parts of the whole recording, sorted and merged across takes. */
  skips: RecordingRange[]
}

export interface TimelineClip {
  clip: RecordingClip
  startMs: number
  endMs: number
}

/** Shorter skips than this are dropped: too short to hear, and easy to make by accident. */
export const MIN_RECORDING_SKIP_MS = 200
/** A transcript line counts as skipped when at least this share of it is. */
const SKIPPED_LINE_SHARE = 0.5

export function recordingTimeline(clips: readonly RecordingClip[]): RecordingTimeline {
  const ordered = [...clips].sort((left, right) => left.position - right.position)
  const timeline: TimelineClip[] = []
  const skips: RecordingRange[] = []
  let startMs = 0
  for (const clip of ordered) {
    const endMs = startMs + clip.durationMs
    timeline.push({ clip, startMs, endMs })
    for (const skip of clip.skips) skips.push({ startMs: startMs + skip.startMs, endMs: startMs + Math.min(skip.endMs, clip.durationMs) })
    startMs = endMs
  }
  return { clips: timeline, durationMs: startMs, skips: mergeRanges(skips) }
}

/** Sorts ranges and joins those that overlap or touch. Empty ranges are dropped. */
export function mergeRanges(ranges: readonly RecordingRange[]): RecordingRange[] {
  const sorted = ranges.filter((range) => range.endMs > range.startMs).sort((left, right) => left.startMs - right.startMs)
  const merged: RecordingRange[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs)
    else merged.push({ ...range })
  }
  return merged
}

/** Clamps a take's skips to its length, merges them, and drops ones too short to matter. */
export function normalizeClipSkips(skips: readonly RecordingRange[], durationMs: number): RecordingRange[] {
  const clamped = skips.map((skip) => ({
    startMs: Math.max(0, Math.min(Math.round(skip.startMs), durationMs)),
    endMs: Math.max(0, Math.min(Math.round(skip.endMs), durationMs)),
  }))
  return mergeRanges(clamped).filter((skip) => skip.endMs - skip.startMs >= MIN_RECORDING_SKIP_MS)
}

/** The take playing at `ms`, and how far into it. The end of the recording is the end of its last take. */
export function clipAt(timeline: RecordingTimeline, ms: number): { index: number; offsetMs: number } | null {
  const { clips } = timeline
  if (!clips.length) return null
  const time = Math.max(0, Math.min(ms, timeline.durationMs))
  let index = clips.findIndex((entry) => time < entry.endMs)
  if (index < 0) index = clips.length - 1
  return { index, offsetMs: time - clips[index]!.startMs }
}

/** The skipped part `ms` falls in, if any. A skip's end is not in it. */
export function skipAt(skips: readonly RecordingRange[], ms: number): RecordingRange | null {
  return skips.find((skip) => ms >= skip.startMs && ms < skip.endMs) ?? null
}

/** Where playback should be at `ms`: past the end of a skipped part it lands in. */
export function playablePosition(skips: readonly RecordingRange[], ms: number): number {
  let position = ms
  // Merged skips never touch, so one jump is enough; the loop guards against unmerged input.
  for (let skip = skipAt(skips, position); skip; skip = skipAt(skips, position)) position = skip.endMs
  return position
}

/** How long the recording plays with its skipped parts left out. */
export function playableDurationMs(timeline: RecordingTimeline): number {
  return timeline.durationMs - timeline.skips.reduce((total, skip) => total + skip.endMs - skip.startMs, 0)
}

/**
 * Every skip in the recording with `range` (in recording time) skipped or kept, as the update the
 * server takes. Skips are split at take boundaries, since each take stores its own.
 */
export function updateTimelineSkips(timeline: RecordingTimeline, range: RecordingRange, skipped: boolean): RecordingSkipUpdate[] {
  const startMs = Math.max(0, Math.min(range.startMs, range.endMs))
  const endMs = Math.min(timeline.durationMs, Math.max(range.startMs, range.endMs))
  const updates: RecordingSkipUpdate[] = []
  for (const entry of timeline.clips) {
    let skips: RecordingRange[] = entry.clip.skips.map((skip) => ({ ...skip }))
    const from = Math.max(startMs, entry.startMs) - entry.startMs
    const to = Math.min(endMs, entry.endMs) - entry.startMs
    if (to > from) skips = skipped ? [...skips, { startMs: from, endMs: to }] : subtractRange(skips, { startMs: from, endMs: to })
    for (const skip of normalizeClipSkips(skips, entry.clip.durationMs)) updates.push({ clipId: entry.clip.id, ...skip })
  }
  return updates
}

function subtractRange(ranges: readonly RecordingRange[], cut: RecordingRange): RecordingRange[] {
  return ranges.flatMap((range) => {
    if (range.endMs <= cut.startMs || range.startMs >= cut.endMs) return [range]
    const pieces: RecordingRange[] = []
    if (range.startMs < cut.startMs) pieces.push({ startMs: range.startMs, endMs: cut.startMs })
    if (range.endMs > cut.endMs) pieces.push({ startMs: cut.endMs, endMs: range.endMs })
    return pieces
  })
}

/** How much of `range` the skips cover, in milliseconds. */
export function skippedOverlapMs(skips: readonly RecordingRange[], range: RecordingRange): number {
  return skips.reduce((total, skip) => total + Math.max(0, Math.min(skip.endMs, range.endMs) - Math.max(skip.startMs, range.startMs)), 0)
}

export interface TranscriptLine {
  /** Stable across refreshes: the take and the segment's place in it. */
  key: string
  clipId: string
  clipIndex: number
  startMs: number
  endMs: number
  text: string
  skipped: boolean
}

/** The transcript in recording time, line by line, marking lines that are mostly skipped. */
export function transcriptLines(timeline: RecordingTimeline): TranscriptLine[] {
  return timeline.clips.flatMap((entry, clipIndex) => entry.clip.transcript.segments.map((segment, index) => {
    const startMs = entry.startMs + Math.min(segment.startMs, entry.clip.durationMs)
    const endMs = Math.max(startMs, entry.startMs + Math.min(segment.endMs, entry.clip.durationMs))
    const length = endMs - startMs
    const skipped = length > 0
      ? skippedOverlapMs(timeline.skips, { startMs, endMs }) >= length * SKIPPED_LINE_SHARE
      : Boolean(skipAt(timeline.skips, startMs))
    return { key: `${entry.clip.id}:${index}`, clipId: entry.clip.id, clipIndex, startMs, endMs, text: segment.text.trim(), skipped }
  })).filter((line) => line.text)
}

/** The line being heard at `ms`: the last one started by then, until the next begins. */
export function activeTranscriptLine(lines: readonly TranscriptLine[], ms: number): TranscriptLine | null {
  let active: TranscriptLine | null = null
  for (const line of lines) {
    if (line.startMs > ms) break
    active = line
  }
  return active && ms < Math.max(active.endMs, active.startMs + 1) + 1_500 ? active : null
}

/** "4:05", or "1:02:03" past an hour. */
export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** A measured level in dBFS as a stored waveform level, 0–100. */
export function recordingLevel(decibels: number | null | undefined): number {
  return Math.round(normalizeDictationDecibels(decibels) * 100)
}

/** The interval between stored waveform levels. */
export const RECORDING_LEVEL_INTERVAL_MS = 1000 / RECORDING_LEVELS_PER_SECOND

/**
 * The recording's waveform squeezed into `count` bars, each the loudest level in its stretch of
 * time, 0–1. Takes recorded without levels show as a low line.
 */
export function waveformBars(timeline: RecordingTimeline, count: number): number[] {
  const bars = Array<number>(Math.max(0, count)).fill(0)
  if (!count || timeline.durationMs <= 0) return bars
  const msPerBar = timeline.durationMs / count
  for (const entry of timeline.clips) {
    const { levels, durationMs } = entry.clip
    const firstBar = Math.floor(entry.startMs / msPerBar)
    const lastBar = Math.min(count - 1, Math.ceil(entry.endMs / msPerBar) - 1)
    if (!levels.length) {
      for (let bar = firstBar; bar <= lastBar; bar++) bars[bar] = Math.max(bars[bar]!, 0.04)
      continue
    }
    for (let bar = firstBar; bar <= lastBar; bar++) {
      const from = Math.max(0, bar * msPerBar - entry.startMs)
      const to = Math.min(durationMs, (bar + 1) * msPerBar - entry.startMs)
      const first = Math.min(levels.length - 1, Math.floor(from / RECORDING_LEVEL_INTERVAL_MS))
      const last = Math.min(levels.length - 1, Math.max(first, Math.ceil(to / RECORDING_LEVEL_INTERVAL_MS) - 1))
      let peak = 0
      for (let index = first; index <= last; index++) peak = Math.max(peak, levels[index]!)
      bars[bar] = Math.max(bars[bar]!, peak / 100)
    }
  }
  return bars
}

export interface RecordingTextOptions {
  /** Shown above the transcript, e.g. the recording's name as a heading. */
  title?: string
  /** Leaves out skipped parts (noting where they were) instead of marking them. */
  omitSkipped?: boolean
}

/**
 * The transcript as plain text with timestamps, for downloads and agents. Takes are headed when
 * there are several, and takes without a transcript yet say so.
 */
export function recordingTranscriptText(clips: readonly RecordingClip[], options: RecordingTextOptions = {}): string {
  const timeline = recordingTimeline(clips)
  const lines = transcriptLines(timeline)
  const out: string[] = []
  if (options.title) out.push(options.title, '')
  const takes = timeline.clips.length
  out.push(`Voice recording, ${formatRecordingTime(timeline.durationMs)} long${takes === 1 ? '' : `, ${takes} takes`}${timeline.skips.length ? `, ${timeline.skips.length} part${timeline.skips.length === 1 ? '' : 's'} marked to skip` : ''}.`)
  if (!takes) {
    out.push('', 'Nothing has been recorded yet.')
    return out.join('\n')
  }
  timeline.clips.forEach((entry, index) => {
    out.push('')
    if (takes > 1) out.push(`Take ${index + 1} (from ${formatRecordingTime(entry.startMs)})`)
    const { status } = entry.clip.transcript
    if (status !== 'ready') {
      out.push(status === 'pending' ? '[Still being transcribed.]' : status === 'unavailable' ? '[Not transcribed: transcription is turned off.]' : '[The transcript could not be made.]')
      return
    }
    const own = lines.filter((line) => line.clipId === entry.clip.id)
    if (!own.length) out.push('[No speech.]')
    let skipping = false
    for (const line of own) {
      if (line.skipped && options.omitSkipped) {
        if (!skipping) out.push(`[Skipped from ${formatRecordingTime(line.startMs)}]`)
        skipping = true
        continue
      }
      skipping = false
      out.push(`[${formatRecordingTime(line.startMs)}]${line.skipped ? ' (skipped)' : ''} ${line.text}`)
    }
  })
  return out.join('\n')
}
