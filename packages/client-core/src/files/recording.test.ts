import { describe, expect, it } from 'vitest'
import type { RecordingClip } from '@pulpo/contracts'
import {
  activeTranscriptLine,
  clipAt,
  formatRecordingTime,
  mergeRanges,
  normalizeClipSkips,
  playableDurationMs,
  playablePosition,
  recordingLevel,
  recordingTimeline,
  recordingTranscriptText,
  transcriptLines,
  updateTimelineSkips,
  waveformBars,
} from './recording.js'

function clip(id: string, position: number, durationMs: number, extra: Partial<RecordingClip> = {}): RecordingClip {
  return {
    id,
    position,
    mimeType: 'audio/webm',
    sizeBytes: 100,
    durationMs,
    levels: [],
    skips: [],
    transcript: { status: 'ready', segments: [], error: null },
    recordedAt: '2026-10-25T12:00:00.000Z',
    createdAt: '2026-10-25T12:00:00.000Z',
    ...extra,
  }
}

describe('recordingTimeline', () => {
  it('lays takes end to end by position and moves their skips into recording time', () => {
    const timeline = recordingTimeline([
      clip('b', 2, 5_000, { skips: [{ startMs: 0, endMs: 1_000 }] }),
      clip('a', 1, 10_000, { skips: [{ startMs: 9_000, endMs: 10_000 }] }),
    ])
    expect(timeline.clips.map((entry) => [entry.clip.id, entry.startMs, entry.endMs])).toEqual([['a', 0, 10_000], ['b', 10_000, 15_000]])
    expect(timeline.durationMs).toBe(15_000)
    // The skip at the end of one take and the start of the next is one part to jump over.
    expect(timeline.skips).toEqual([{ startMs: 9_000, endMs: 11_000 }])
    expect(playableDurationMs(timeline)).toBe(13_000)
  })

  it('finds the take at a time, holding the end of the last one', () => {
    const timeline = recordingTimeline([clip('a', 0, 1_000), clip('b', 1, 1_000)])
    expect(clipAt(timeline, 0)).toEqual({ index: 0, offsetMs: 0 })
    expect(clipAt(timeline, 1_000)).toEqual({ index: 1, offsetMs: 0 })
    expect(clipAt(timeline, 5_000)).toEqual({ index: 1, offsetMs: 1_000 })
    expect(clipAt(recordingTimeline([]), 0)).toBeNull()
  })
})

describe('skips', () => {
  it('merges overlapping and touching ranges', () => {
    expect(mergeRanges([{ startMs: 5, endMs: 8 }, { startMs: 0, endMs: 2 }, { startMs: 2, endMs: 3 }, { startMs: 7, endMs: 9 }, { startMs: 4, endMs: 4 }]))
      .toEqual([{ startMs: 0, endMs: 3 }, { startMs: 5, endMs: 9 }])
  })

  it('clamps skips to the take and drops slivers', () => {
    expect(normalizeClipSkips([{ startMs: -50, endMs: 400 }, { startMs: 900, endMs: 1_000 }, { startMs: 1_500, endMs: 9_000 }], 2_000))
      .toEqual([{ startMs: 0, endMs: 400 }, { startMs: 1_500, endMs: 2_000 }])
  })

  it('jumps past a skipped part', () => {
    const skips = [{ startMs: 1_000, endMs: 2_000 }]
    expect(playablePosition(skips, 500)).toBe(500)
    expect(playablePosition(skips, 1_000)).toBe(2_000)
    expect(playablePosition(skips, 1_999)).toBe(2_000)
    expect(playablePosition(skips, 2_000)).toBe(2_000)
  })

  it('splits a new skip across takes and keeps the rest', () => {
    const timeline = recordingTimeline([
      clip('a', 0, 10_000, { skips: [{ startMs: 1_000, endMs: 2_000 }] }),
      clip('b', 1, 10_000),
    ])
    expect(updateTimelineSkips(timeline, { startMs: 18_000, endMs: 8_000 }, true)).toEqual([
      { clipId: 'a', startMs: 1_000, endMs: 2_000 },
      { clipId: 'a', startMs: 8_000, endMs: 10_000 },
      { clipId: 'b', startMs: 0, endMs: 8_000 },
    ])
  })

  it('keeps part of a skip, splitting it around what is kept', () => {
    const timeline = recordingTimeline([clip('a', 0, 10_000, { skips: [{ startMs: 1_000, endMs: 9_000 }] })])
    expect(updateTimelineSkips(timeline, { startMs: 4_000, endMs: 5_000 }, false)).toEqual([
      { clipId: 'a', startMs: 1_000, endMs: 4_000 },
      { clipId: 'a', startMs: 5_000, endMs: 9_000 },
    ])
    expect(updateTimelineSkips(timeline, { startMs: 0, endMs: 10_000 }, false)).toEqual([])
  })
})

describe('transcript', () => {
  const timeline = recordingTimeline([
    clip('a', 0, 10_000, {
      skips: [{ startMs: 4_000, endMs: 8_000 }],
      transcript: {
        status: 'ready',
        error: null,
        segments: [
          { startMs: 0, endMs: 4_000, text: ' Hello there. ' },
          { startMs: 4_000, endMs: 7_000, text: 'Um, let me find it.' },
          { startMs: 7_000, endMs: 10_000, text: 'Here it is.' },
          { startMs: 10_000, endMs: 10_000, text: '   ' },
        ],
      },
    }),
    clip('b', 1, 5_000, { transcript: { status: 'pending', segments: [], error: null } }),
  ])

  it('places lines in recording time and marks the mostly skipped ones', () => {
    expect(transcriptLines(timeline).map(({ key, startMs, text, skipped }) => ({ key, startMs, text, skipped }))).toEqual([
      { key: 'a:0', startMs: 0, text: 'Hello there.', skipped: false },
      { key: 'a:1', startMs: 4_000, text: 'Um, let me find it.', skipped: true },
      { key: 'a:2', startMs: 7_000, text: 'Here it is.', skipped: false },
    ])
  })

  it('follows the line being heard', () => {
    const lines = transcriptLines(timeline)
    expect(activeTranscriptLine(lines, 0)?.key).toBe('a:0')
    expect(activeTranscriptLine(lines, 7_500)?.key).toBe('a:2')
    expect(activeTranscriptLine(lines, 14_000)).toBeNull()
  })

  it('writes the transcript as text, leaving out skipped parts when asked', () => {
    expect(recordingTranscriptText(timeline.clips.map((entry) => entry.clip), { omitSkipped: true })).toBe([
      'Voice recording, 0:15 long, 2 takes, 1 part marked to skip.',
      '',
      'Take 1 (from 0:00)',
      '[0:00] Hello there.',
      '[Skipped from 0:04]',
      '[0:07] Here it is.',
      '',
      'Take 2 (from 0:10)',
      '[Still being transcribed.]',
    ].join('\n'))
    expect(recordingTranscriptText([timeline.clips[0]!.clip], { title: '# Notes' })).toBe([
      '# Notes',
      '',
      'Voice recording, 0:10 long, 1 part marked to skip.',
      '',
      '[0:00] Hello there.',
      '[0:04] (skipped) Um, let me find it.',
      '[0:07] Here it is.',
    ].join('\n'))
    expect(recordingTranscriptText([])).toBe('Voice recording, 0:00 long, 0 takes.\n\nNothing has been recorded yet.')
  })
})

describe('display helpers', () => {
  it('formats times past an hour', () => {
    expect(formatRecordingTime(0)).toBe('0:00')
    expect(formatRecordingTime(65_999)).toBe('1:05')
    expect(formatRecordingTime(3_723_000)).toBe('1:02:03')
  })

  it('stores levels as whole percentages', () => {
    expect(recordingLevel(0)).toBe(100)
    expect(recordingLevel(-80)).toBe(0)
    expect(recordingLevel(null)).toBe(0)
  })

  it('squeezes the waveform into bars by the loudest level', () => {
    const timeline = recordingTimeline([
      clip('a', 0, 1_000, { levels: [10, 90, 20, 0, 0, 0, 0, 0, 50, 40] }),
      clip('b', 1, 1_000),
    ])
    expect(waveformBars(timeline, 4)).toEqual([0.9, 0.5, 0.04, 0.04])
    expect(waveformBars(recordingTimeline([]), 3)).toEqual([0, 0, 0])
  })
})
