import { useEffect, useState } from 'react'
import {
  DICTATION_LEVEL_INTERVAL_MS,
  decibelsFromSamples,
  emptyDictationLevels,
  normalizeDictationDecibels,
  pushDictationLevel,
} from '@pulpo/client-core'

export type DictationPhase = 'idle' | 'preparing' | 'recording' | 'transcribing'

/** Desktop composers are wide, so web keeps about ten seconds of history. */
export const WEB_DICTATION_WAVEFORM_SAMPLES = 128
/** Samples microphone loudness from a live stream. Levels are oldest first; the newest is last. */
export function useMicrophoneLevels(stream: MediaStream | null, samples = WEB_DICTATION_WAVEFORM_SAMPLES): readonly number[] {
  const [levels, setLevels] = useState<readonly number[]>(() => emptyDictationLevels(samples))
  useEffect(() => {
    setLevels((current) => current.length === samples && current.every((level) => level === 0) ? current : emptyDictationLevels(samples))
    if (!stream || typeof AudioContext === 'undefined') return undefined
    let context: AudioContext
    let source: MediaStreamAudioSourceNode
    let analyser: AnalyserNode
    try {
      context = new AudioContext()
      source = context.createMediaStreamSource(stream)
      analyser = context.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
    } catch {
      // Metering is decorative; recording continues with a flat waveform.
      return undefined
    }
    // Safari can create the context suspended because it starts after the permission prompt.
    if (context.state === 'suspended') void context.resume().catch(() => undefined)
    const buffer = new Float32Array(analyser.fftSize)
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      const level = normalizeDictationDecibels(decibelsFromSamples(buffer))
      setLevels((current) => pushDictationLevel(current, level))
    }, DICTATION_LEVEL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      source.disconnect()
      void context.close().catch(() => undefined)
    }
  }, [samples, stream])
  return levels
}
