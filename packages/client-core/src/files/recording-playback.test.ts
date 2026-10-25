import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingClip } from '@pulpo/contracts'
import { nextRecordingRate, RecordingPlayback, type RecordingClipAudio } from './recording-playback.js'
import { recordingTimeline } from './recording.js'

function clip(id: string, position: number, durationMs: number, skips: RecordingClip['skips'] = []): RecordingClip {
  return {
    id, position, mimeType: 'audio/mp4', sizeBytes: 1, durationMs, levels: [], skips,
    transcript: { status: 'ready', segments: [], error: null },
    recordedAt: '2026-10-25T12:00:00.000Z', createdAt: '2026-10-25T12:00:00.000Z',
  }
}

/** Audio whose clock advances with the fake timers while it plays. */
class FakeAudio implements RecordingClipAudio {
  time = 0
  playing = false
  rate = 1
  disposed = false
  constructor(readonly id: string, readonly lengthSeconds: number) {}
  play() { this.playing = true }
  pause() { this.playing = false }
  seek(seconds: number) { this.time = seconds }
  currentTime() { return this.time }
  ended() { return this.time >= this.lengthSeconds }
  setRate(rate: number) { this.rate = rate }
  dispose() { this.disposed = true }
  advance(ms: number) { if (this.playing) this.time = Math.min(this.lengthSeconds, this.time + (ms / 1000) * this.rate) }
}

describe('RecordingPlayback', () => {
  let audios: Map<string, FakeAudio>
  let playback: RecordingPlayback
  const run = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      for (const audio of audios.values()) audio.advance(50)
      await vi.advanceTimersByTimeAsync(50)
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    audios = new Map()
    playback = new RecordingPlayback({
      load: async (take) => {
        const audio = new FakeAudio(take.id, take.durationMs / 1000)
        audios.set(take.id, audio)
        return audio
      },
    })
  })
  afterEach(() => {
    playback.dispose()
    vi.useRealTimers()
  })

  it('plays the takes one after another and stops at the end', async () => {
    playback.setTimeline(recordingTimeline([clip('a', 0, 1_000), clip('b', 1, 1_000)]))
    playback.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(playback.getSnapshot().status).toBe('playing')
    await run(1_200)
    expect(audios.get('b')?.playing).toBe(true)
    expect(audios.get('a')?.playing).toBe(false)
    expect(playback.getSnapshot().positionMs).toBeGreaterThan(1_000)
    await run(1_000)
    expect(playback.getSnapshot()).toMatchObject({ status: 'paused', positionMs: 2_000 })
    // Playing again starts over.
    playback.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(audios.get('a')?.time).toBe(0)
  })

  it('jumps over skipped parts, across takes, unless skipping is off', async () => {
    playback.setTimeline(recordingTimeline([clip('a', 0, 2_000, [{ startMs: 500, endMs: 2_000 }]), clip('b', 1, 2_000, [{ startMs: 0, endMs: 500 }])]))
    playback.play()
    await run(700)
    expect(audios.get('b')?.playing).toBe(true)
    expect(audios.get('b')!.time).toBeGreaterThanOrEqual(0.5)

    playback.setSkipping(false)
    playback.seek(0)
    await run(700)
    expect(audios.get('a')?.playing).toBe(true)
    expect(playback.getSnapshot().positionMs).toBeGreaterThan(600)
  })

  it('plays a skipped part that is sought into on purpose', async () => {
    playback.setTimeline(recordingTimeline([clip('a', 0, 3_000, [{ startMs: 1_000, endMs: 2_000 }])]))
    playback.play()
    await vi.advanceTimersByTimeAsync(0)
    playback.seek(1_200)
    await run(300)
    expect(playback.getSnapshot().positionMs).toBeGreaterThanOrEqual(1_400)
    expect(playback.getSnapshot().positionMs).toBeLessThan(2_000)
    // Once it leaves that part, later visits to it are skipped again.
    await run(1_000)
    playback.seekBy(-15_000)
    await run(1_100)
    expect(playback.getSnapshot().positionMs).toBeGreaterThanOrEqual(2_000)
  })

  it('starts after a skip at the very start, and keeps the rate across takes', async () => {
    playback.setTimeline(recordingTimeline([clip('a', 0, 1_000, [{ startMs: 0, endMs: 400 }]), clip('b', 1, 1_000)]))
    playback.setRate(2)
    playback.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(audios.get('a')).toMatchObject({ time: 0.4, rate: 2 })
    await run(400)
    expect(audios.get('b')?.rate).toBe(2)
  })

  it('pauses where it is and resumes from there', async () => {
    playback.setTimeline(recordingTimeline([clip('a', 0, 5_000)]))
    playback.play()
    await run(1_000)
    playback.pause()
    const { positionMs } = playback.getSnapshot()
    expect(positionMs).toBeGreaterThanOrEqual(900)
    await run(1_000)
    expect(playback.getSnapshot()).toMatchObject({ status: 'paused', positionMs })
    playback.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(audios.get('a')!.time * 1000).toBeCloseTo(positionMs, -1)
  })

  it('reports load failures and tries again on the next play', async () => {
    let fail = true
    const failing = new RecordingPlayback({
      load: async (take) => {
        if (fail) throw new Error('offline')
        return new FakeAudio(take.id, 1)
      },
      errorMessage: (error) => `Could not play: ${(error as Error).message}`,
    })
    failing.setTimeline(recordingTimeline([clip('a', 0, 1_000)]))
    failing.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(failing.getSnapshot()).toMatchObject({ status: 'error', error: 'Could not play: offline' })
    fail = false
    failing.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(failing.getSnapshot()).toMatchObject({ status: 'playing', error: null })
    failing.dispose()
  })

  it('stops when the take being played is removed', async () => {
    playback.setTimeline(recordingTimeline([clip('a', 0, 5_000), clip('b', 1, 1_000)]))
    playback.play()
    await run(200)
    playback.setTimeline(recordingTimeline([clip('b', 1, 1_000)]))
    expect(playback.getSnapshot()).toMatchObject({ status: 'paused', positionMs: expect.any(Number) })
    expect(playback.getSnapshot().positionMs).toBeLessThanOrEqual(1_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(audios.get('a')?.disposed).toBe(true)
  })

  it('cycles through playback speeds', () => {
    expect(nextRecordingRate(1)).toBe(1.25)
    expect(nextRecordingRate(2)).toBe(0.75)
    expect(nextRecordingRate(0.75)).toBe(1)
    expect(nextRecordingRate(3)).toBe(1)
  })
})
