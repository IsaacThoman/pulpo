// @vitest-environment node
import { recordingTimeline, transcriptLines } from '@pulpo/client-core/files'
import type { FileRecording, RecordingClip } from '@pulpo/contracts'
import { describe, expect, it } from 'vitest'
import { rangeSkipped, rangeTouchesSkip, takeTitle, transcriptRows, withSkips } from './rows'

function clip(id: string, position: number, transcript: RecordingClip['transcript'], skips: RecordingClip['skips'] = []): RecordingClip {
  return {
    id, position, mimeType: 'audio/mp4', sizeBytes: 1, durationMs: 10_000, levels: [], skips, transcript,
    recordedAt: '2026-10-25T14:04:00.000Z', createdAt: '2026-10-25T14:04:10.000Z',
  }
}

describe('recording transcript rows', () => {
  it('heads each take and says why one has no lines', () => {
    const timeline = recordingTimeline([
      clip('a', 0, { status: 'ready', error: null, segments: [{ startMs: 0, endMs: 2_000, text: 'Hello.' }] }),
      clip('b', 1, { status: 'pending', error: null, segments: [] }),
      clip('c', 2, { status: 'ready', error: null, segments: [] }),
      clip('d', 3, { status: 'failed', error: 'Busy', segments: [] }),
    ])
    const rows = transcriptRows(timeline, transcriptLines(timeline))
    expect(rows.map((row) => row.type === 'note' ? `note:${row.note}` : row.type === 'take' ? `take:${row.index}:${row.startMs}` : `line:${row.line.text}`)).toEqual([
      'take:0:0', 'line:Hello.',
      'take:1:10000', 'note:pending',
      'take:2:20000', 'note:silent',
      'take:3:30000', 'note:failed',
    ])
  })

  it('titles takes by number and time recorded', () => {
    expect(takeTitle(1, '2026-10-25T14:04:00.000Z', 'en-US')).toMatch(/^Take 2 · \d{1,2}:04 [AP]M$/)
    expect(takeTitle(0, 'not a date')).toBe('Take 1')
  })

  it('applies skip changes as the server will store them', () => {
    const recording = { node: {} as FileRecording['node'], clips: [clip('a', 0, { status: 'ready', error: null, segments: [] }, [{ startMs: 0, endMs: 1_000 }])] }
    expect(withSkips(recording, [{ clipId: 'a', startMs: 5_000, endMs: 60_000 }, { clipId: 'a', startMs: 100, endMs: 150 }]).clips[0]!.skips).toEqual([{ startMs: 5_000, endMs: 10_000 }])
  })

  it('tells whether a selection is skipped all through or in part', () => {
    const skips = [{ startMs: 1_000, endMs: 3_000 }]
    expect(rangeSkipped(skips, { startMs: 1_000, endMs: 3_000 })).toBe(true)
    expect(rangeSkipped(skips, { startMs: 500, endMs: 3_000 })).toBe(false)
    expect(rangeTouchesSkip(skips, { startMs: 500, endMs: 1_500 })).toBe(true)
    expect(rangeTouchesSkip(skips, { startMs: 3_000, endMs: 4_000 })).toBe(false)
  })
})
