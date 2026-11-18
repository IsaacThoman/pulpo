import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { activeSegmentIndex, audioClock, transcriptErrorMessage } from './transcript'

const segments = [
  { start: 0.5, end: 2, text: 'One' },
  { start: 2, end: 4, text: 'Two' },
  { start: 6, end: 8, text: 'Three' },
]

describe('audio transcript helpers', () => {
  it('finds the segment being spoken, holding it through pauses', () => {
    expect(activeSegmentIndex(segments, 0)).toBeNull()
    expect(activeSegmentIndex(segments, 0.5)).toBe(0)
    expect(activeSegmentIndex(segments, 2)).toBe(1)
    expect(activeSegmentIndex(segments, 5)).toBe(1)
    expect(activeSegmentIndex(segments, 99)).toBe(2)
    expect(activeSegmentIndex([], 3)).toBeNull()
  })

  it('formats clock times, with hours for long recordings', () => {
    expect(audioClock(0)).toBe('0:00')
    expect(audioClock(65.9)).toBe('1:05')
    expect(audioClock(3725)).toBe('1:02:05')
    expect(audioClock(Number.NaN)).toBe('0:00')
  })

  it('explains known failures and hides server details', () => {
    expect(transcriptErrorMessage(new ApiError(422, 'dictation_no_speech', 'No speech'))).toBe('No speech was detected in this audio.')
    expect(transcriptErrorMessage(new ApiError(402, 'daily_spend_limit_reached', 'Daily limit reached'))).toBe('Daily limit reached')
    expect(transcriptErrorMessage(new ApiError(502, 'dictation_provider_error', 'Upstream exploded'))).toBe('This audio couldn’t be transcribed. Try again.')
  })
})
