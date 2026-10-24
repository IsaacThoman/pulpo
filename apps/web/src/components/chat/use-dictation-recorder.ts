import { useCallback, useEffect, useRef, useState } from 'react'
import { DICTATION_MAX_SECONDS } from '@pulpo/client-core'
import { speechPlayback } from '@/features/speech/state'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { dictationFilename, preferredDictationMimeType } from '@/lib/dictation'
import type { DictationPhase } from './use-microphone-levels'

export interface DictationRecorder {
  phase: DictationPhase
  /** The live microphone while recording, for the waveform. */
  stream: MediaStream | null
  startedAt: number | null
  error: string | null
  setError: (error: string | null) => void
  /** Opens the microphone and starts recording. False when this browser cannot record. */
  start: () => boolean
  /** Finishes the recording and transcribes it. */
  stop: () => void
  /** Discards the recording or in-flight transcription. */
  cancel: () => void
}

/**
 * Records from the microphone and transcribes the recording with Pulpo dictation.
 * `onTranscript` receives the non-empty transcript; the latest callback is used, so it may
 * read state from the render the transcript arrives in.
 */
export function useDictationRecorder(onTranscript: (text: string) => void): DictationRecorder {
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<DictationPhase>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Increments on every start and cancel so callbacks from an abandoned recording are ignored. */
  const sessionRef = useRef(0)

  const releaseMicrophone = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    setStream(null)
  }, [])

  const transcribe = useCallback(async (blob: Blob, mimeType: string) => {
    setPhase('transcribing')
    const controller = new AbortController()
    abortRef.current = controller
    const form = new FormData()
    form.set('file', blob, dictationFilename(mimeType))
    try {
      const result = await apiRequest<{ text: string }>('/api/dictation/transcriptions', {
        method: 'POST', body: form, signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (!result.text.trim()) throw new Error(ui("No speech was detected in the recording"))
      onTranscriptRef.current(result.text)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : ui("Unable to transcribe the recording"))
    } finally {
      // A cancelled transcription has already reset the UI, possibly for a newer recording.
      if (abortRef.current === controller) {
        abortRef.current = null
        setPhase('idle')
      }
    }
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    sessionRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    chunksRef.current = []
    releaseMicrophone()
    setPhase('idle')
  }, [releaseMicrophone])

  const record = useCallback(async (session: number) => {
    const current = () => sessionRef.current === session
    let opened: MediaStream | null = null
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!current()) {
        opened.getTracks().forEach((track) => track.stop())
        return
      }
      const preferredType = preferredDictationMimeType()
      const recorder = preferredType ? new MediaRecorder(opened, { mimeType: preferredType }) : new MediaRecorder(opened)
      mediaStreamRef.current = opened
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) }
      recorder.onerror = () => {
        if (!current()) return
        chunksRef.current = []
        mediaRecorderRef.current = null
        setError(ui("Microphone recording failed"))
        releaseMicrophone()
        setPhase('idle')
      }
      recorder.onstop = () => {
        if (!current()) return
        const chunks = chunksRef.current
        chunksRef.current = []
        mediaRecorderRef.current = null
        releaseMicrophone()
        if (chunks.length === 0) {
          setPhase('idle')
          return
        }
        const mimeType = recorder.mimeType || preferredType || 'audio/webm'
        void transcribe(new Blob(chunks, { type: mimeType }), mimeType)
      }
      recorder.start()
      setStream(opened)
      setStartedAt(Date.now())
      setPhase('recording')
      timerRef.current = window.setTimeout(() => stop(), DICTATION_MAX_SECONDS * 1000)
    } catch (cause) {
      if (!current()) {
        opened?.getTracks().forEach((track) => track.stop())
        return
      }
      mediaRecorderRef.current = null
      if (mediaStreamRef.current !== opened) opened?.getTracks().forEach((track) => track.stop())
      releaseMicrophone()
      setPhase('idle')
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? ui("Microphone permission was denied")
        : ui("Unable to access the microphone"))
    }
  }, [releaseMicrophone, stop, transcribe])

  const start = useCallback(() => {
    speechPlayback.stop()
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(ui("This browser does not support microphone recording"))
      return false
    }
    const session = ++sessionRef.current
    setPhase('preparing')
    void record(session)
    return true
  }, [record])

  useEffect(() => () => {
    sessionRef.current += 1
    abortRef.current?.abort()
    const recorder = mediaRecorderRef.current
    if (recorder) recorder.onstop = null
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    releaseMicrophone()
  }, [releaseMicrophone])

  return { phase, stream, startedAt, error, setError, start, stop, cancel }
}
