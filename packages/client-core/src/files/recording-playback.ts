import type { RecordingClip, RecordingRange } from '@pulpo/contracts'
import { clipAt, playablePosition, recordingTimeline, skipAt, type RecordingTimeline } from './recording.js'

/** One take's audio, loaded by the platform (an audio element on the web, a native player on phones). */
export interface RecordingClipAudio {
  /** Plays from the current time. */
  play(): void | Promise<void>
  pause(): void
  /** Seconds from the start of the take. */
  seek(seconds: number): void | Promise<void>
  currentTime(): number
  /** True once the audio has played to its end. */
  ended(): boolean
  setRate(rate: number): void
  dispose(): void
}

export type RecordingPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export interface RecordingPlaybackState {
  status: RecordingPlaybackStatus
  /** Where playback is, in milliseconds from the start of the recording. */
  positionMs: number
  rate: number
  /** Whether playback jumps over the parts marked to skip. */
  skipping: boolean
  error: string | null
}

export interface RecordingPlaybackOptions {
  load: (clip: RecordingClip, signal: AbortSignal) => Promise<RecordingClipAudio>
  /** How often the position is read while playing. */
  intervalMs?: number
  /** Turns load failures into the message shown. */
  errorMessage?: (error: unknown) => string
}

export const RECORDING_PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75] as const
/** How far the back and forward buttons move. */
export const RECORDING_SEEK_MS = 15_000
/** Audio is loaded for at most this many takes at once. */
const CACHED_TAKES = 4
/** Next take's audio is loaded this close to the end of the current one. */
const PREFETCH_MS = 15_000
/** Players can run a little past a take's measured length before reporting its end. */
const END_SLACK_MS = 250

export function nextRecordingRate(rate: number): number {
  const index = RECORDING_PLAYBACK_RATES.indexOf(rate as typeof RECORDING_PLAYBACK_RATES[number])
  return RECORDING_PLAYBACK_RATES[(index + 1) % RECORDING_PLAYBACK_RATES.length]!
}

const sameRange = (left: RecordingRange | null, right: RecordingRange | null) =>
  Boolean(left && right && left.startMs === right.startMs && left.endMs === right.endMs)

/**
 * Plays a recording's takes one after another as one piece of audio, jumping over skipped parts
 * unless skipping is off. A skipped part the listener seeks into on purpose plays until it ends.
 * Platform players are wrapped as `RecordingClipAudio`; this owns everything else.
 */
export class RecordingPlayback {
  private state: RecordingPlaybackState = { status: 'idle', positionMs: 0, rate: 1, skipping: true, error: null }
  private listeners = new Set<() => void>()
  private timeline: RecordingTimeline = recordingTimeline([])
  private audio = new Map<string, { promise: Promise<RecordingClipAudio>; controller: AbortController; used: number }>()
  private current: { clipId: string; audio: RecordingClipAudio } | null = null
  /** Bumped by every play, pause, and seek, so slower earlier ones give way. */
  private generation = 0
  private timer: ReturnType<typeof setInterval> | null = null
  /** A skipped part entered on purpose, which plays instead of being jumped over. */
  private entered: RecordingRange | null = null
  private uses = 0
  private disposed = false

  constructor(private readonly options: RecordingPlaybackOptions) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.state

  private update(next: Partial<RecordingPlaybackState>) {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }

  /** The recording changed: takes were added or removed, or skips changed. */
  setTimeline(timeline: RecordingTimeline) {
    this.timeline = timeline
    const live = new Set(timeline.clips.map((entry) => entry.clip.id))
    for (const [id, cached] of this.audio) {
      if (live.has(id)) continue
      cached.controller.abort()
      void cached.promise.then((audio) => audio.dispose(), () => undefined)
      this.audio.delete(id)
    }
    if (this.current && !live.has(this.current.clipId)) {
      this.current = null
      this.halt('paused')
    }
    if (this.state.positionMs > timeline.durationMs) this.update({ positionMs: timeline.durationMs })
  }

  play = () => {
    if (!this.timeline.clips.length || this.disposed) return
    let position = this.state.positionMs
    if (position >= this.timeline.durationMs - 50) position = 0
    if (this.state.skipping && !sameRange(skipAt(this.timeline.skips, position), this.entered)) position = playablePosition(this.timeline.skips, position)
    if (position >= this.timeline.durationMs) position = this.state.skipping ? playablePosition(this.timeline.skips, 0) : 0
    if (position >= this.timeline.durationMs) return
    void this.startAt(position)
  }

  pause = () => {
    if (this.state.status !== 'playing' && this.state.status !== 'loading') return
    const position = this.livePosition()
    this.halt('paused')
    this.update({ positionMs: position })
  }

  toggle = () => {
    if (this.state.status === 'playing' || this.state.status === 'loading') this.pause()
    else this.play()
  }

  /** Moves to `ms`. A skipped part sought into on purpose plays rather than being jumped over. */
  seek = (ms: number) => {
    const position = Math.max(0, Math.min(Math.round(ms), this.timeline.durationMs))
    this.entered = skipAt(this.timeline.skips, position)
    if (this.state.status === 'playing' || this.state.status === 'loading') void this.startAt(position)
    else this.update({ positionMs: position, error: null })
  }

  seekBy = (deltaMs: number) => {
    const position = this.livePosition() + deltaMs
    // Stepping back lands before a skipped part rather than inside it.
    const skip = deltaMs < 0 && this.state.skipping ? skipAt(this.timeline.skips, position) : null
    this.seek(skip ? Math.max(0, skip.startMs - 1) : position)
  }

  setRate = (rate: number) => {
    this.current?.audio.setRate(rate)
    this.update({ rate })
  }

  setSkipping = (skipping: boolean) => {
    this.entered = null
    this.update({ skipping })
  }

  dispose = () => {
    this.disposed = true
    this.halt('idle')
    for (const cached of this.audio.values()) {
      cached.controller.abort()
      void cached.promise.then((audio) => audio.dispose(), () => undefined)
    }
    this.audio.clear()
    this.listeners.clear()
  }

  /** The position now, read from the playing audio rather than the last update. */
  livePosition(): number {
    const current = this.current
    const entry = current && this.timeline.clips.find((candidate) => candidate.clip.id === current.clipId)
    if (!current || !entry || this.state.status !== 'playing') return this.state.positionMs
    return entry.startMs + Math.min(current.audio.currentTime() * 1000, entry.clip.durationMs)
  }

  private halt(status: RecordingPlaybackStatus) {
    this.generation++
    this.stopTimer()
    this.current?.audio.pause()
    this.update({ status })
  }

  private stopTimer() {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private audioFor(clip: RecordingClip): Promise<RecordingClipAudio> {
    const cached = this.audio.get(clip.id)
    if (cached) {
      cached.used = ++this.uses
      return cached.promise
    }
    const controller = new AbortController()
    const promise = this.options.load(clip, controller.signal)
    const entry = { promise, controller, used: ++this.uses }
    this.audio.set(clip.id, entry)
    // A failed load is forgotten so the next play tries again.
    promise.catch(() => { if (this.audio.get(clip.id) === entry) this.audio.delete(clip.id) })
    this.evict()
    return promise
  }

  private evict() {
    while (this.audio.size > CACHED_TAKES) {
      const [id, oldest] = [...this.audio.entries()]
        .filter(([candidate]) => candidate !== this.current?.clipId)
        .sort(([, left], [, right]) => left.used - right.used)[0] ?? []
      if (!id || !oldest) return
      oldest.controller.abort()
      void oldest.promise.then((audio) => audio.dispose(), () => undefined)
      this.audio.delete(id)
    }
  }

  private async startAt(position: number) {
    const generation = ++this.generation
    const at = clipAt(this.timeline, position)
    if (!at) return
    const entry = this.timeline.clips[at.index]!
    if (this.current && this.current.clipId !== entry.clip.id) this.current.audio.pause()
    const loaded = this.audio.get(entry.clip.id)
    this.update({ positionMs: position, error: null, ...(this.current?.clipId === entry.clip.id && loaded ? {} : { status: 'loading' }) })
    try {
      const audio = await this.audioFor(entry.clip)
      if (generation !== this.generation) return
      this.current = { clipId: entry.clip.id, audio }
      audio.setRate(this.state.rate)
      await audio.seek(at.offsetMs / 1000)
      if (generation !== this.generation) return
      await audio.play()
      if (generation !== this.generation) return
      this.update({ status: 'playing' })
      if (this.timer === null) this.timer = setInterval(() => this.tick(), this.options.intervalMs ?? 50)
    } catch (error) {
      if (generation !== this.generation) return
      this.stopTimer()
      this.update({ status: 'error', error: this.options.errorMessage?.(error) ?? 'The recording could not be played' })
    }
  }

  private finish() {
    this.halt('paused')
    this.entered = null
    this.update({ positionMs: this.timeline.durationMs })
  }

  private tick() {
    const current = this.current
    if (!current || this.state.status !== 'playing') return
    const index = this.timeline.clips.findIndex((entry) => entry.clip.id === current.clipId)
    const entry = this.timeline.clips[index]
    if (!entry) return
    const offset = current.audio.currentTime() * 1000
    const position = entry.startMs + Math.min(offset, entry.clip.durationMs)
    const { skips, durationMs } = this.timeline
    if (current.audio.ended() || offset >= entry.clip.durationMs + END_SLACK_MS) {
      const next = this.state.skipping ? playablePosition(skips, entry.endMs) : entry.endMs
      if (next >= durationMs) this.finish()
      else void this.startAt(next)
      return
    }
    if (this.state.skipping) {
      const skip = skipAt(skips, position)
      if (skip && !sameRange(skip, this.entered)) {
        if (skip.endMs >= durationMs) this.finish()
        else void this.startAt(skip.endMs)
        return
      }
      if (!skip) this.entered = null
    }
    const following = this.timeline.clips[index + 1]
    if (following && entry.endMs - position < PREFETCH_MS) void this.audioFor(following.clip).catch(() => undefined)
    this.update({ positionMs: position })
  }
}
