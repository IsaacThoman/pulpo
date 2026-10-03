import { useEffect, useState } from 'react'
import { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated'
import { DICTATION_STALLED_STATUS_DELAY_MS, formatDictationElapsed } from '@pulpo/client-core'
import type { DictationState } from './dictation'

export const DICTATION_WAVEFORM_HEIGHT = 28
/** Half the composer toolbar height: the strip and toolbar roll past each other by this much. */
const TOGGLE_OFFSET = 22

export const DICTATION_TOGGLE_TIMING = { duration: 260, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.System } as const

/** Rolls the strip up from below the toolbar, like the faces of a turning drum. */
export const dictationStripEntering: EntryExitAnimationFunction = () => {
  'worklet'
  return {
    initialValues: { opacity: 0, transform: [{ translateY: TOGGLE_OFFSET }] },
    animations: {
      opacity: withTiming(1, DICTATION_TOGGLE_TIMING),
      transform: [{ translateY: withTiming(0, DICTATION_TOGGLE_TIMING) }],
    },
  }
}

export const dictationStripExiting: EntryExitAnimationFunction = () => {
  'worklet'
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, DICTATION_TOGGLE_TIMING),
      transform: [{ translateY: withTiming(TOGGLE_OFFSET, DICTATION_TOGGLE_TIMING) }],
    },
  }
}

/** Moves the regular composer toolbar out of the way while the dictation strip is shown. */
export function useDictationToolbarStyle(dictating: boolean) {
  const progress = useSharedValue(dictating ? 1 : 0)
  useEffect(() => {
    progress.value = withTiming(dictating ? 1 : 0, DICTATION_TOGGLE_TIMING)
  }, [dictating, progress])
  return useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -TOGGLE_OFFSET * progress.value }],
  }))
}

export function dictationStatusLabel(phase: DictationState['phase'], seconds: number): string {
  switch (phase) {
    case 'recording': return `Recording ${formatDictationElapsed(seconds)}`
    case 'transcribing': return 'Transcribing…'
    case 'cancelling': return 'Cancelling…'
    default: return 'Preparing microphone…'
  }
}

/**
 * True once `key` has stayed the same non-null value for `delayMs`. A different key,
 * including the same phase in a later session, starts the wait again.
 */
export function useStalled(key: string | null, delayMs = DICTATION_STALLED_STATUS_DELAY_MS): boolean {
  const [state, setState] = useState({ key, stalled: false })
  if (state.key !== key) setState({ key, stalled: false })
  useEffect(() => {
    if (key === null) return undefined
    const timer = setTimeout(() => setState((current) => current.key === key ? { key, stalled: true } : current), delayMs)
    return () => clearTimeout(timer)
  }, [key, delayMs])
  return key !== null && state.key === key && state.stalled
}
