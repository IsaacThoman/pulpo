export function insertDictationText(current: string, transcript: string, start: number, end = start): { value: string; cursor: number } {
  const clean = transcript.trim()
  if (!clean) return { value: current, cursor: Math.max(0, Math.min(start, current.length)) }
  const from = Math.max(0, Math.min(start, current.length))
  const to = Math.max(from, Math.min(end, current.length))
  const before = current.slice(0, from)
  const after = current.slice(to)
  const inserted = `${before && !/\s$/.test(before) ? ' ' : ''}${clean}${after && !/^\s/.test(after) ? ' ' : ''}`
  return { value: before + inserted + after, cursor: before.length + inserted.length - (after && !/^\s/.test(after) ? 1 : 0) }
}

/** Level history length; at the sampling interval this shows roughly the last five seconds. */
export const DICTATION_WAVEFORM_SAMPLES = 64
export const DICTATION_LEVEL_INTERVAL_MS = 80
/** Horizontal distance between waveform bars, including the bar itself. */
export const DICTATION_WAVEFORM_BAR_PITCH = 5
export const DICTATION_WAVEFORM_BAR_WIDTH = 2
/** The recorder stops itself after this many seconds. */
export const DICTATION_MAX_SECONDS = 90
/**
 * Brief waits (opening the microphone, cancelling) keep the still waveform on screen;
 * a text status replaces it only after the wait lasts this long.
 */
export const DICTATION_STALLED_STATUS_DELAY_MS = 1000
/** Remaining seconds at which the elapsed timer starts warning about the limit. */
export const DICTATION_WARNING_SECONDS = 10

const NOISE_FLOOR_DECIBELS = -60
const NOISE_FLOOR_AMPLITUDE = 10 ** (NOISE_FLOOR_DECIBELS / 20)

/** Converts measured dBFS to a 0–1 bar height, compressed so quiet speech stays visible. */
export function normalizeDictationDecibels(decibels: number | null | undefined): number {
  if (decibels == null || Number.isNaN(decibels) || decibels <= NOISE_FLOOR_DECIBELS) return 0
  if (decibels >= 0) return 1
  const amplitude = 10 ** (decibels / 20)
  return Math.sqrt((amplitude - NOISE_FLOOR_AMPLITUDE) / (1 - NOISE_FLOOR_AMPLITUDE))
}

/** RMS level of PCM samples in the -1…1 range, in dBFS. Silence is -Infinity. */
export function decibelsFromSamples(samples: ArrayLike<number>): number {
  if (samples.length === 0) return -Infinity
  let sum = 0
  for (let index = 0; index < samples.length; index++) sum += samples[index]! * samples[index]!
  return 20 * Math.log10(Math.sqrt(sum / samples.length))
}

export function emptyDictationLevels(length = DICTATION_WAVEFORM_SAMPLES): number[] {
  return Array<number>(length).fill(0)
}

/**
 * Appends the newest level and drops the oldest. Returns the same array while the
 * history is silent so subscribers can skip redundant renders.
 */
export function pushDictationLevel(history: readonly number[], level: number): readonly number[] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
  if (clamped === 0 && history.every((sample) => sample === 0)) return history
  return [...history.slice(1), clamped]
}

/**
 * Bars needed to fill the measured width while the waveform scrolls: every slot,
 * plus the one sliding out past the left edge as the newest enters on the right.
 * Never more than the level history holds.
 */
export function dictationWaveformBarCount(width: number, samples = DICTATION_WAVEFORM_SAMPLES): number {
  return Math.max(2, Math.min(samples, Math.ceil(Math.max(0, width) / DICTATION_WAVEFORM_BAR_PITCH) + 1))
}

export function formatDictationElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function dictationNearsLimit(seconds: number, max = DICTATION_MAX_SECONDS): boolean {
  return seconds >= max - DICTATION_WARNING_SECONDS
}
