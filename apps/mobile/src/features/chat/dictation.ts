import {
  DICTATION_LEVEL_INTERVAL_MS,
  DICTATION_MAX_SECONDS,
  emptyDictationLevels,
  normalizeDictationDecibels,
  pushDictationLevel,
} from '@pulpo/client-core'

export const MAX_DICTATION_BYTES = 10 * 1024 * 1024
export const MAX_DICTATION_SECONDS = DICTATION_MAX_SECONDS

export type DictationState = {
  phase: 'idle' | 'preparing' | 'recording' | 'transcribing' | 'cancelling'
  seconds: number
  error: string | null
}

export interface DictationRecorder {
  prepare(): Promise<void>
  record(): void
  stop(): Promise<void>
  release(): void
  readonly uri: string | null
  readonly isRecording: boolean
  /** Current input level in dBFS, when the recorder meters audio. */
  metering?(): number | undefined
}

export interface DictationLevelSource {
  getLevels(): readonly number[]
  subscribeLevels(listener: () => void): () => void
}

export interface DictationDependencies {
  permission(): Promise<boolean>
  isForeground?(): boolean
  audioMode(recording: boolean): Promise<void>
  recorder(): DictationRecorder
  size(uri: string): number
  remove(uri: string): void
  /** Called as a recording starts so slow transcriber setup can overlap with it. */
  warmUp?(): void
  transcribe(uri: string, signal: AbortSignal): Promise<string>
}

/** Owns a recording until cleanup finishes, including cancellation during native preparation. */
export class DictationController implements DictationLevelSource {
  private state: DictationState = { phase: 'idle', seconds: 0, error: null }
  requestingPermission = false
  private listeners = new Set<() => void>()
  private active: { abort: AbortController; finish: () => void; error: string | null } | null = null
  private levels: readonly number[] = emptyDictationLevels()
  private levelListeners = new Set<() => void>()

  constructor(private readonly deps: DictationDependencies) {}
  getSnapshot = (): DictationState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Recent input levels, oldest first. Kept apart from state so meters do not re-render the composer. */
  getLevels = (): readonly number[] => this.levels
  subscribeLevels = (listener: () => void): (() => void) => {
    this.levelListeners.add(listener)
    return () => { this.levelListeners.delete(listener) }
  }
  get busy(): boolean { return this.active !== null }
  private sampleLevel(recorder: DictationRecorder): void {
    let decibels: number | undefined
    // A missed meter reading only drops one waveform sample; it never ends the recording.
    try { decibels = recorder.metering?.() } catch { decibels = undefined }
    this.setLevels(pushDictationLevel(this.levels, normalizeDictationDecibels(decibels)))
  }
  private setLevels(levels: readonly number[]): void {
    if (levels === this.levels) return
    this.levels = levels
    this.levelListeners.forEach((listener) => listener())
  }
  private update(patch: Partial<DictationState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  stop = (): void => {
    if (this.state.phase === 'recording') this.active?.finish()
  }
  cancel = (): void => {
    if (!this.active) {
      if (this.state.error) this.update({ error: null })
      return
    }
    this.active.abort.abort()
    this.active.finish()
    this.update({ phase: 'cancelling' })
  }

  start = async (apply: (text: string) => void): Promise<void> => {
    if (this.active) return
    let finish!: () => void
    const stopped = new Promise<void>((resolve) => { finish = resolve })
    const active = { abort: new AbortController(), finish, error: null as string | null }
    this.active = active
    this.update({ phase: 'preparing', seconds: 0, error: null })
    this.setLevels(emptyDictationLevels())
    try { this.deps.warmUp?.() } catch { /* Transcription reports setup failures itself. */ }
    let recorder: DictationRecorder | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let stoppedRecorder = false
    let error: string | null = null
    const cancelled = () => active.abort.signal.aborted
    try {
      this.requestingPermission = true
      let granted: boolean
      try { granted = await this.deps.permission() } finally { this.requestingPermission = false }
      if (cancelled()) return
      if (!granted) throw new Error('Microphone access is denied. Enable it in Settings to use dictation.')
      await this.deps.audioMode(true)
      if (cancelled()) return
      recorder = this.deps.recorder()
      await recorder.prepare()
      if (cancelled()) return
      if (this.deps.isForeground?.() === false) throw new Error('Recording was interrupted. Please try again.')
      recorder.record()
      this.update({ phase: 'recording' })
      const started = Date.now()
      timer = setInterval(() => {
        const seconds = Math.min(MAX_DICTATION_SECONDS, Math.floor((Date.now() - started) / 1000))
        if (seconds !== this.state.seconds) this.update({ seconds })
        if (seconds >= MAX_DICTATION_SECONDS) finish()
        else {
          try {
            if (recorder!.isRecording) {
              this.sampleLevel(recorder!)
              return
            }
          } catch { /* A native media reset can invalidate the recorder. */ }
          active.error = 'Recording was interrupted. Please try again.'
          finish()
        }
      }, DICTATION_LEVEL_INTERVAL_MS)
      await stopped
      clearInterval(timer)
      if (cancelled()) return
      if (active.error) throw new Error(active.error)
      this.update({ phase: 'transcribing' })
      await recorder.stop()
      stoppedRecorder = true
      await this.deps.audioMode(false)
      if (cancelled()) return
      const uri = recorder.uri
      const bytes = uri ? this.deps.size(uri) : 0
      if (!uri || bytes === 0) throw new Error('The recording is empty. Please try again.')
      if (bytes > MAX_DICTATION_BYTES) throw new Error('Dictation recordings must be 10 MB or smaller.')
      const text = await this.deps.transcribe(uri, active.abort.signal)
      if (!cancelled()) {
        if (!text.trim()) throw new Error('No speech was detected. Please try again.')
        apply(text)
      }
    } catch (cause) {
      if (!cancelled()) error = cause instanceof Error ? cause.message : 'Dictation failed. Please try again.'
    } finally {
      clearInterval(timer)
      if (recorder) {
        if (!stoppedRecorder) await recorder.stop().catch(() => undefined)
        // Native media services may reset during cleanup; still release and reset the UI.
        let uri: string | null = null
        try { uri = recorder.uri } catch { /* The native recorder may already be invalid. */ }
        try { recorder.release() } catch { /* A reset can already have released it. */ }
        try { if (uri) this.deps.remove(uri) } catch { error ??= 'Could not remove the temporary recording.' }
      }
      await this.deps.audioMode(false).catch(() => undefined)
      this.active = null
      this.update({ phase: 'idle', error })
    }
  }
}
