/**
 * Value axis scaling in the spirit of Excel's automatic axis limits: zero-based unless the data
 * sits far from zero (the 5/6 rule), 5% headroom past the data, and "nice" major units of
 * 1, 2, or 5 × 10ⁿ sized so labels do not crowd the axis.
 */

export interface AxisScale {
  min: number
  max: number
  majorUnit: number
  /** Tick values from min to max, inclusive. Powers of the base on log axes. */
  ticks: number[]
  /** Log base for logarithmic axes. */
  logBase?: number
}

export interface ScaleOptions {
  /** Most major intervals that fit (from the axis length and label size). */
  maxIntervals: number
  min?: number
  max?: number
  majorUnit?: number
  logBase?: number
  /** Percent-stacked: 0–100% (or -100–100% with negatives). */
  percent?: boolean
}

/** Most ticks we ever generate, whatever the file asks for. */
export const MAX_TICKS = 1000

/** The smallest 1/2/5 × 10ⁿ step that is at least `raw`. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const exponent = Math.floor(Math.log10(raw))
  const magnitude = 10 ** exponent
  const fraction = raw / magnitude
  const nice = fraction <= 1 + 1e-9 ? 1 : fraction <= 2 + 1e-9 ? 2 : fraction <= 5 + 1e-9 ? 5 : 10
  return nice * magnitude
}

/** Removes float noise (0.30000000000000004 → 0.3) relative to `step`. */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return value
  const decimals = Math.max(0, Math.min(15, -Math.floor(Math.log10(Math.abs(step) || 1)) + 2))
  const rounded = Number(value.toFixed(decimals))
  return Object.is(rounded, -0) ? 0 : rounded
}

function ticksFor(min: number, max: number, step: number): number[] {
  const ticks: number[] = []
  const count = Math.round((max - min) / step)
  if (!Number.isFinite(count) || count > MAX_TICKS || count < 0) return [min, max]
  for (let i = 0; i <= count; i++) ticks.push(roundToStep(min + i * step, step))
  return ticks
}

function logScale(dataMin: number, dataMax: number, options: ScaleOptions & { logBase: number }): AxisScale {
  const base = options.logBase
  const log = (value: number) => Math.log(value) / Math.log(base)
  const positiveMin = dataMin > 0 ? dataMin : dataMax > 0 ? Math.min(dataMax, 1) : 1
  const positiveMax = dataMax > 0 ? dataMax : base
  let min = options.min !== undefined && options.min > 0 ? options.min : base ** Math.floor(log(positiveMin) + 1e-9)
  let max = options.max !== undefined && options.max > 0 ? options.max : base ** Math.ceil(log(positiveMax) - 1e-9)
  if (max <= min) max = min * base
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) {
    min = 1
    max = base
  }
  const ticks: number[] = []
  const first = Math.ceil(log(min) - 1e-9)
  const last = Math.floor(log(max) + 1e-9)
  const every = Math.max(1, Math.ceil((last - first + 1) / Math.max(1, options.maxIntervals)))
  for (let k = first; k <= last && ticks.length < MAX_TICKS; k += every) ticks.push(base ** k)
  return { min, max, majorUnit: base, ticks, logBase: base }
}

/**
 * Computes the axis range and ticks for data spanning `dataMin`–`dataMax` (pass NaN for no data).
 * Fixed min/max/majorUnit from the file win when they are usable.
 */
export function computeValueScale(dataMin: number, dataMax: number, options: ScaleOptions): AxisScale {
  const maxIntervals = Math.max(1, Math.min(50, Math.floor(options.maxIntervals)))
  if (options.logBase) return logScale(dataMin, dataMax, { ...options, logBase: options.logBase, maxIntervals })

  let low = Number.isFinite(dataMin) ? dataMin : 0
  let high = Number.isFinite(dataMax) ? dataMax : low
  if (low > high) [low, high] = [high, low]

  if (options.percent) {
    // Shares run from -100% to 100%; scale the part the data uses.
    low = Math.max(-1, Math.min(0, low))
    high = Math.min(1, Math.max(0, high))
  }

  const fixedMin = options.min !== undefined && Number.isFinite(options.min) ? options.min : undefined
  const fixedMax = options.max !== undefined && Number.isFinite(options.max) ? options.max : undefined

  // No spread to pad when the range was made up.
  const flat = low === high
  if (flat) {
    if (low === 0) high = 1
    else if (low > 0) low = 0
    else high = 0
  }

  // Zero-based unless the data sits far from zero.
  let autoMin = low
  let autoMax = high
  if (!options.percent) {
    if (low >= 0 && low <= (5 / 6) * high) autoMin = 0
    if (high <= 0 && high >= (5 / 6) * low) autoMax = 0
  }
  let lowerBound = fixedMin ?? autoMin
  let upperBound = fixedMax ?? autoMax
  if (lowerBound >= upperBound) {
    if (fixedMin !== undefined && fixedMax === undefined) upperBound = lowerBound + Math.abs(lowerBound || 1)
    else if (fixedMax !== undefined && fixedMin === undefined) lowerBound = upperBound - Math.abs(upperBound || 1)
    else upperBound = lowerBound + 1
  }

  const span = upperBound - lowerBound
  let step: number
  const fixedUnit = options.majorUnit
  if (fixedUnit !== undefined && fixedUnit > 0 && span / fixedUnit <= MAX_TICKS) step = fixedUnit
  else {
    // Headroom first, then pick a step for the padded range.
    const padded = span * (options.percent || flat ? 1 : 1.05)
    step = niceStep(padded / maxIntervals)
  }

  let min = lowerBound
  let max = upperBound
  if (fixedMin === undefined) {
    if (!options.percent && autoMin !== 0 && autoMin === low && high > 0 && low > 0) {
      // Data far from zero: start half a range below it.
      min = Math.floor((low - (high - low) / 2) / step) * step
      if (min < 0) min = 0
    } else if (autoMin !== 0) {
      min = Math.floor((lowerBound - 0.05 * span) / step) * step
    } else min = 0
  }
  if (fixedMax === undefined) {
    if (autoMax === 0 && !options.percent) max = 0
    else max = Math.ceil((upperBound + (options.percent || flat ? 0 : 0.05 * span)) / step - 1e-9) * step
  }
  if (fixedMin === undefined && autoMax === 0 && !options.percent && high <= 0 && low < 0) {
    min = Math.floor((lowerBound - 0.05 * Math.abs(lowerBound)) / step + 1e-9) * step
  }
  if (options.percent) {
    if (fixedMin === undefined) min = Math.max(-1, min)
    if (fixedMax === undefined) max = Math.min(1, max)
  }
  if (max <= min) max = min + step
  min = roundToStep(min, step)
  max = roundToStep(max, step)
  // A fixed bound that is not a multiple of the step still gets ticks from min upward.
  return { min, max, majorUnit: step, ticks: ticksFor(min, max, step).filter((t) => t <= max + step * 1e-9) }
}
