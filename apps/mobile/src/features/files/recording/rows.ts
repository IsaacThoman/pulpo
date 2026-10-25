import { normalizeClipSkips, skippedOverlapMs, type RecordingTimeline, type TranscriptLine } from '@pulpo/client-core/files'
import type { FileRecording, RecordingClip, RecordingRange, RecordingSkipUpdate } from '@pulpo/contracts'

/** What the transcript list shows: a heading per take, its lines, or why it has none. */
export type TranscriptRow =
  | { type: 'take'; key: string; clip: RecordingClip; index: number; startMs: number }
  | { type: 'line'; key: string; line: TranscriptLine }
  | { type: 'note'; key: string; clip: RecordingClip; note: 'pending' | 'failed' | 'unavailable' | 'silent' }

export function transcriptRows(timeline: RecordingTimeline, lines: readonly TranscriptLine[]): TranscriptRow[] {
  const byClip = new Map<string, TranscriptLine[]>()
  for (const line of lines) byClip.set(line.clipId, [...byClip.get(line.clipId) ?? [], line])
  return timeline.clips.flatMap((entry, index): TranscriptRow[] => {
    const { clip } = entry
    const heading: TranscriptRow = { type: 'take', key: `take:${clip.id}`, clip, index, startMs: entry.startMs }
    const status = clip.transcript.status
    if (status !== 'ready') return [heading, { type: 'note', key: `note:${clip.id}`, clip, note: status }]
    const own = byClip.get(clip.id) ?? []
    if (!own.length) return [heading, { type: 'note', key: `note:${clip.id}`, clip, note: 'silent' }]
    return [heading, ...own.map((line): TranscriptRow => ({ type: 'line', key: line.key, line }))]
  })
}

/** "Take 2 · 2:04 PM". */
export function takeTitle(index: number, recordedAt: string, locale?: string): string {
  const date = new Date(recordedAt)
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ')
  return time ? `Take ${index + 1} · ${time}` : `Take ${index + 1}`
}

/** The recording with skips replaced by `updates`, as the server will store them. */
export function withSkips(recording: FileRecording, updates: readonly RecordingSkipUpdate[]): FileRecording {
  return {
    ...recording,
    clips: recording.clips.map((clip) => ({
      ...clip,
      skips: normalizeClipSkips(updates.filter((update) => update.clipId === clip.id), clip.durationMs),
    })),
  }
}

/** Whether `range` is skipped all the way through, so the action offered is to keep it. */
export function rangeSkipped(skips: readonly RecordingRange[], range: RecordingRange): boolean {
  const length = range.endMs - range.startMs
  return length > 0 && skippedOverlapMs(skips, range) >= length - 1
}

/** Whether any of `range` is skipped. */
export function rangeTouchesSkip(skips: readonly RecordingRange[], range: RecordingRange): boolean {
  return skippedOverlapMs(skips, range) > 0
}
