import { DICTATION_LEVEL_INTERVAL_MS, emptyDictationLevels, normalizeDictationDecibels, pushDictationLevel } from '@pulpo/client-core'
import { RECORDING_LEVEL_INTERVAL_MS, recordingLevel } from '@pulpo/client-core/files'
import { RECORDING_TAKE_MAX_SECONDS } from '@pulpo/contracts'
import type { DictationLevelSource } from '../../chat/dictation'
import type { RecordedTake } from '../api'

/**
 * `paused`: the take is open but nothing is being recorded (by the user, or by the system while
 * another app has the microphone). `saving`: the take is being finished.
 */
export type TakeRecorderPhase = 'idle' | 'preparing' | 'recording' | 'paused' | 'saving'

export interface TakeRecorderState {
  phase: TakeRecorderPhase
  /**
   * Time recorded since Record was pressed, in whole seconds' steps; takes started at the take
   * limit carry on counting.
   */
  elapsedMs: number
  error: string | null
}

/** The platform's recorder for one take. */
export interface NativeTakeRecorder {
  prepare(): Promise<void>
  record(): void
  pause(): void
  stop(): Promise<void>
  release(): void
  readonly uri: string | null
  /** `durationMillis` counts only time recorded, not time paused; `metering` is in dBFS. */
  status(): { isRecording: boolean; durationMillis: number; metering?: number }
}

export interface TakeRecorderDependencies {
  permission(): Promise<boolean>
  isForeground?(): boolean
  audioMode(recording: boolean): Promise<void>
  recorder(): NativeTakeRecorder
  remove(uri: string): void
  keepAwake?(awake: boolean): void
  now?(): number
}

/** Shorter takes are dropped: a tap on Record and Stop by mistake. */
export const MIN_TAKE_MS = 500
const TAKE_MAX_MS = RECORDING_TAKE_MAX_SECONDS * 1000
const INTERRUPTED = 'Recording paused: another app is using the microphone. Resume or stop when you’re ready.'
const START_INTERRUPTED = 'Recording was interrupted. Please try again.'
const MICROPHONE_UNAVAILABLE = 'The microphone couldn’t start. Check that no other app is using it, then try again.'

interface Take {
  recorder: NativeTakeRecorder
  recordedAt: string
  levels: number[]
  durationMs: number
}

interface Session {
  onTake: (take: RecordedTake) => void
  cancelled: boolean
  take: Take | null
  /** Recorded in this session's earlier takes, which ended at the take limit. */
  previousMs: number
  timer: ReturnType<typeof setInterval> | null
  /** Serializes pausing, resuming, rolling over, and stopping. */
  busy: Promise<void>
}

/**
 * Records takes for a voice recording. Each finished take (Stop, or the take limit, after which
 * recording carries on in a new take) is handed to `onTake` with its waveform; cancelling throws
 * the open take away. Live input levels feed the scrolling waveform as dictation's do.
 */
export class TakeRecorderController implements DictationLevelSource {
  private state: TakeRecorderState = { phase: 'idle', elapsedMs: 0, error: null }
  private listeners = new Set<() => void>()
  private session: Session | null = null
  private levels: readonly number[] = emptyDictationLevels()
  private levelListeners = new Set<() => void>()
  requestingPermission = false

  constructor(private readonly deps: TakeRecorderDependencies) {}

  getSnapshot = (): TakeRecorderState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getLevels = (): readonly number[] => this.levels
  subscribeLevels = (listener: () => void): (() => void) => {
    this.levelListeners.add(listener)
    return () => { this.levelListeners.delete(listener) }
  }

  /** Whether a take is open: preparing, recording, paused, or being saved. */
  get active(): boolean { return this.session !== null }

  clearError = (): void => { if (this.state.error) this.update({ error: null }) }

  private update(patch: Partial<TakeRecorderState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private setLevels(levels: readonly number[]): void {
    if (levels === this.levels) return
    this.levels = levels
    this.levelListeners.forEach((listener) => listener())
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  start = async (onTake: (take: RecordedTake) => void): Promise<void> => {
    if (this.session) return
    const session: Session = { onTake, cancelled: false, take: null, previousMs: 0, timer: null, busy: Promise.resolve() }
    this.session = session
    this.update({ phase: 'preparing', elapsedMs: 0, error: null })
    this.setLevels(emptyDictationLevels())
    try {
      this.requestingPermission = true
      let granted: boolean
      try { granted = await this.deps.permission() } finally { this.requestingPermission = false }
      if (session.cancelled) return
      if (!granted) throw new Error('Microphone access is denied. Enable it in Settings to record.')
      await this.deps.audioMode(true)
      if (session.cancelled) return
      await this.openTake(session)
    } catch (cause) {
      if (this.session !== session) return
      await this.close(session, false)
      this.update({ error: cause instanceof Error ? cause.message : 'Recording couldn’t start. Please try again.' })
    }
  }

  private async openTake(session: Session): Promise<void> {
    const recorder = this.deps.recorder()
    try {
      await recorder.prepare()
      if (session.cancelled) throw new Error('Cancelled')
      if (this.deps.isForeground?.() === false) throw new Error(START_INTERRUPTED)
      recorder.record()
    } catch (error) {
      this.discard(recorder)
      if (session.cancelled) return
      // Native failures (no input device, the microphone held elsewhere) read as one plain message.
      throw error instanceof Error && error.message === START_INTERRUPTED ? error : new Error(MICROPHONE_UNAVAILABLE)
    }
    session.take = { recorder, recordedAt: new Date(this.now()).toISOString(), levels: [], durationMs: 0 }
    this.deps.keepAwake?.(true)
    this.update({ phase: 'recording' })
    if (session.timer === null) session.timer = setInterval(() => this.tick(session), DICTATION_LEVEL_INTERVAL_MS)
  }

  private tick(session: Session): void {
    const take = session.take
    if (this.session !== session || !take || this.state.phase !== 'recording') return
    let status: ReturnType<NativeTakeRecorder['status']>
    try {
      status = take.recorder.status()
    } catch {
      // A native media reset invalidates the recorder: keep what was recorded.
      this.queue(session, () => this.finish(session, 'Recording was interrupted. The take so far was saved.'))
      return
    }
    if (!status.isRecording) {
      // The system took the microphone (a call, another app); the take stays open.
      this.update({ phase: 'paused', error: INTERRUPTED })
      return
    }
    take.durationMs = Math.max(take.durationMs, status.durationMillis)
    const level = recordingLevel(status.metering)
    while (take.levels.length < Math.floor(take.durationMs / RECORDING_LEVEL_INTERVAL_MS)) take.levels.push(level)
    this.setLevels(pushDictationLevel(this.levels, normalizeDictationDecibels(status.metering)))
    const elapsedMs = Math.floor((session.previousMs + take.durationMs) / 1000) * 1000
    if (elapsedMs !== this.state.elapsedMs) this.update({ elapsedMs })
    if (take.durationMs >= TAKE_MAX_MS) this.queue(session, () => this.rollOver(session))
  }

  private queue(session: Session, step: () => Promise<void>): Promise<void> {
    session.busy = session.busy.then(step, step)
    return session.busy
  }

  /** At the take limit: finish this take and carry on recording in a new one. */
  private async rollOver(session: Session): Promise<void> {
    const take = session.take
    if (this.session !== session || !take || take.durationMs < TAKE_MAX_MS) return
    session.take = null
    session.previousMs += take.durationMs
    await this.hand(session, take)
    try {
      await this.openTake(session)
    } catch (cause) {
      await this.close(session, false)
      this.update({ error: cause instanceof Error ? cause.message : 'Recording stopped at the take limit.' })
    }
  }

  pause = (): void => {
    const session = this.session
    if (!session?.take || this.state.phase !== 'recording') return
    try { session.take.recorder.pause() } catch { /* Already stopped by the system. */ }
    this.update({ phase: 'paused' })
  }

  resume = (): void => {
    const session = this.session
    if (!session?.take || this.state.phase !== 'paused') return
    if (this.deps.isForeground?.() === false) return
    try {
      session.take.recorder.record()
      this.update({ phase: 'recording', error: null })
    } catch {
      this.update({ error: 'The microphone isn’t available right now. Stop to save the take.' })
    }
  }

  /** Finishes the open take and hands it over. Resolves once the recorder is closed. */
  stop = (): Promise<void> => {
    const session = this.session
    if (!session) return Promise.resolve()
    if (!session.take) {
      // Still preparing: nothing has been recorded yet.
      this.cancel()
      return Promise.resolve()
    }
    return this.queue(session, () => this.finish(session, null))
  }

  /** Throws the open take away. */
  cancel = (): void => {
    const session = this.session
    if (!session) return
    session.cancelled = true
    const take = session.take
    session.take = null
    if (take) {
      void take.recorder.stop().catch(() => undefined).finally(() => this.discard(take.recorder))
    }
    void this.close(session, true)
  }

  private async finish(session: Session, error: string | null): Promise<void> {
    if (this.session !== session) return
    const take = session.take
    session.take = null
    this.update({ phase: 'saving' })
    if (take) {
      try {
        const status = take.recorder.status()
        take.durationMs = Math.max(take.durationMs, status.durationMillis)
      } catch { /* The duration measured so far stands. */ }
      await this.hand(session, take)
    }
    await this.close(session, false)
    if (error) this.update({ error })
  }

  /** Stops a finished take's recorder and gives its file to `onTake`, or drops it if too short. */
  private async hand(session: Session, take: Take): Promise<void> {
    await take.recorder.stop().catch(() => undefined)
    let uri: string | null = null
    try { uri = take.recorder.uri } catch { /* The native recorder may already be invalid. */ }
    try { take.recorder.release() } catch { /* A reset can already have released it. */ }
    if (!uri) return
    if (take.durationMs < MIN_TAKE_MS) {
      this.remove(uri)
      return
    }
    const levels = take.levels.slice(0, Math.ceil(take.durationMs / RECORDING_LEVEL_INTERVAL_MS))
    try {
      session.onTake({ uri, durationMs: take.durationMs, levels, recordedAt: take.recordedAt })
    } catch {
      this.update({ error: 'The take couldn’t be kept on this device.' })
    }
  }

  private discard(recorder: NativeTakeRecorder): void {
    let uri: string | null = null
    try { uri = recorder.uri } catch { /* Invalid after a reset. */ }
    try { recorder.release() } catch { /* Already released. */ }
    if (uri) this.remove(uri)
  }

  private remove(uri: string): void {
    try { this.deps.remove(uri) } catch { /* Left for the system to clear from the cache. */ }
  }

  private async close(session: Session, cancelled: boolean): Promise<void> {
    if (session.timer !== null) clearInterval(session.timer)
    session.timer = null
    if (this.session !== session) return
    this.session = null
    this.deps.keepAwake?.(false)
    this.setLevels(emptyDictationLevels())
    this.update({ phase: 'idle', elapsedMs: cancelled ? 0 : this.state.elapsedMs })
    await this.deps.audioMode(false).catch(() => undefined)
  }
}
