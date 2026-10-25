import { useCallback, useEffect, useRef, useState } from 'react'
import { RECORDING_AUDIO_BITS_PER_SECOND, RECORDING_TAKE_MAX_SECONDS } from '@pulpo/contracts'
import { decibelsFromSamples, emptyDictationLevels, normalizeDictationDecibels, pushDictationLevel } from '@pulpo/client-core'
import { RECORDING_LEVEL_INTERVAL_MS, recordingLevel } from '@pulpo/client-core/files'
import { speechPlayback } from '@/features/speech/state'
import { ui } from '@/i18n/ui'
import { queueTake } from './take-uploads'

export type RecorderPhase = 'idle' | 'preparing' | 'recording' | 'paused'

/** Waveform history shown while recording: enough to fill a wide player. */
export const LIVE_WAVEFORM_SAMPLES = 240

export function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  // The server re-encodes every take, so the browser's best speech codec is fine.
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
    .find((type) => MediaRecorder.isTypeSupported(type))
}

/** One take being recorded: its recorder, audio so far, and timing with pauses left out. */
interface TakeSession {
  recorder: MediaRecorder
  chunks: Blob[]
  levels: number[]
  recordedAt: string
  /** Milliseconds recorded before the current stretch. */
  recordedMs: number
  /** When the current stretch started, or null while paused. */
  runningSince: number | null
  discarded: boolean
}

function sessionMs(session: TakeSession, now = performance.now()): number {
  return session.recordedMs + (session.runningSince === null ? 0 : now - session.runningSince)
}

export interface TakeRecorder {
  phase: RecorderPhase
  /** Milliseconds in the take being recorded, pauses left out. */
  elapsedMs: number
  /** Recent loudness, 0–1, oldest first, for the live waveform. */
  levels: readonly number[]
  error: string | null
  setError: (error: string | null) => void
  /** Opens the microphone and starts a take, appended to the end of the recording. */
  start: () => void
  pause: () => void
  resume: () => void
  /** Finishes the take and saves it. */
  stop: () => void
  /** Throws the take away. */
  discard: () => void
}

/**
 * Records takes from the microphone for a voice recording. A finished take is handed to the
 * upload queue, so it is saved even if the page goes away. Takes longer than the limit carry on
 * seamlessly in a new take, recorded from the same microphone stream.
 */
export function useTakeRecorder(recordingId: string, options: { onStart?: () => void } = {}): TakeRecorder {
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [levels, setLevels] = useState<readonly number[]>(() => emptyDictationLevels(LIVE_WAVEFORM_SAMPLES))
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<TakeSession | null>(null)
  const meterRef = useRef<{ context: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null)
  const timerRef = useRef<number | null>(null)
  /** Bumped on every start and stop, so a microphone that opens late is closed again. */
  const attemptRef = useRef(0)
  const onStart = useRef(options.onStart)
  onStart.current = options.onStart

  const release = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    const meter = meterRef.current
    meterRef.current = null
    if (meter) {
      meter.source.disconnect()
      void meter.context.close().catch(() => undefined)
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  /** Starts a take on the open microphone. The previous take, if any, keeps recording until stopped. */
  const begin = useCallback((stream: MediaStream): TakeSession => {
    const mimeType = preferredRecordingMimeType()
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND })
    const session: TakeSession = {
      recorder, chunks: [], levels: [], recordedAt: new Date().toISOString(), recordedMs: 0, runningSince: performance.now(), discarded: false,
    }
    recorder.ondataavailable = (event) => { if (event.data.size > 0) session.chunks.push(event.data) }
    recorder.onstop = () => {
      if (session.discarded || !session.chunks.length) return
      const durationMs = Math.max(1, Math.round(sessionMs(session)))
      queueTake(recordingId, new Blob(session.chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }), {
        durationMs,
        levels: session.levels.slice(0, Math.ceil(durationMs / RECORDING_LEVEL_INTERVAL_MS) + 1),
        recordedAt: session.recordedAt,
      })
    }
    recorder.onerror = () => {
      session.discarded = true
      if (sessionRef.current !== session) return
      sessionRef.current = null
      release()
      setPhase('idle')
      setError(ui("Microphone recording failed"))
    }
    // Regular chunks keep a long take's audio from piling up in one buffer.
    recorder.start(1_000)
    return session
  }, [recordingId, release])

  const sample = useCallback(() => {
    const session = sessionRef.current
    const meter = meterRef.current
    if (!session || session.runningSince === null) return
    let decibels = -Infinity
    if (meter) {
      const buffer = new Float32Array(meter.analyser.fftSize)
      meter.analyser.getFloatTimeDomainData(buffer)
      decibels = decibelsFromSamples(buffer)
    }
    session.levels.push(recordingLevel(decibels))
    setLevels((current) => pushDictationLevel(current, normalizeDictationDecibels(decibels)))
    const elapsed = sessionMs(session)
    setElapsedMs(elapsed)
    if (elapsed >= RECORDING_TAKE_MAX_SECONDS * 1000 && streamRef.current) {
      // Start the next take before stopping this one, so nothing falls between them.
      sessionRef.current = begin(streamRef.current)
      session.runningSince = null
      session.recordedMs = elapsed
      session.recorder.stop()
      setElapsedMs(0)
    }
  }, [begin])

  const start = useCallback(() => {
    if (phase !== 'idle') return
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(ui("This browser does not support microphone recording"))
      return
    }
    speechPlayback.stop()
    onStart.current?.()
    const attempt = ++attemptRef.current
    setPhase('preparing')
    void (async () => {
      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (attempt !== attemptRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        try {
          const context = new AudioContext()
          const source = context.createMediaStreamSource(stream)
          const analyser = context.createAnalyser()
          analyser.fftSize = 2048
          source.connect(analyser)
          if (context.state === 'suspended') void context.resume().catch(() => undefined)
          meterRef.current = { context, source, analyser }
        } catch {
          // Levels are only for the waveform; the take records without them.
        }
        sessionRef.current = begin(stream)
        setElapsedMs(0)
        setLevels(emptyDictationLevels(LIVE_WAVEFORM_SAMPLES))
        timerRef.current = window.setInterval(sample, RECORDING_LEVEL_INTERVAL_MS)
        setPhase('recording')
      } catch (cause) {
        if (attempt !== attemptRef.current) return
        if (streamRef.current !== stream) stream?.getTracks().forEach((track) => track.stop())
        release()
        setPhase('idle')
        setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? ui("Microphone permission was denied")
          : ui("Unable to access the microphone"))
      }
    })()
  }, [begin, phase, release, sample])

  const pause = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.runningSince === null || session.recorder.state !== 'recording') return
    session.recordedMs = sessionMs(session)
    session.runningSince = null
    session.recorder.pause()
    setElapsedMs(session.recordedMs)
    setPhase('paused')
  }, [])

  const resume = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.runningSince !== null || session.recorder.state !== 'paused') return
    session.runningSince = performance.now()
    session.recorder.resume()
    setPhase('recording')
  }, [])

  const finish = useCallback((keep: boolean) => {
    attemptRef.current++
    const session = sessionRef.current
    sessionRef.current = null
    if (session) {
      session.recordedMs = sessionMs(session)
      session.runningSince = null
      session.discarded = !keep
      if (session.recorder.state !== 'inactive') session.recorder.stop()
    }
    release()
    setPhase('idle')
    setElapsedMs(0)
    setLevels(emptyDictationLevels(LIVE_WAVEFORM_SAMPLES))
  }, [release])

  const stop = useCallback(() => finish(true), [finish])
  const discard = useCallback(() => finish(false), [finish])

  // Leaving the recording keeps the take: it is saved like any other.
  useEffect(() => () => finish(true), [finish])

  // Closing the tab mid-take would lose it.
  useEffect(() => {
    if (phase === 'idle') return undefined
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  return { phase, elapsedMs, levels, error, setError, start, pause, resume, stop, discard }
}
