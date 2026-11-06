/**
 * Value axis scaling the way Excel picks it automatically: start at zero unless the data sits far
 * from it, leave about 5% headroom, and step by 1, 2, or 5 times a power of ten so that the axis
 * gets as many gridlines as its length comfortably holds.
 */

export interface ValueScale {
  min: number
  max: number
  majorUnit: number
  /** Logarithmic base, when the axis is logarithmic. */
  logBase?: number
  ticks: number[]
}

export interface ScaleRequest {
  dataMin: number
  dataMax: number
  /** Most major intervals the axis has room for. */
  maxIntervals: number
  min?: number
  max?: number
  majorUnit?: number
  logBase?: number
  /** Percent-stacked plots: the data already spans 0..1 (or -1..1), so no headroom. */
  exact?: boolean
}

const MAX_TICKS = 1000

/** The smallest of 1, 2, 5 × 10^n that is at least `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  for (const factor of [1, 2, 5, 10]) {
    if (factor * power >= raw * (1 - 1e-9)) return factor * power
  }
  return 10 * power
}

/** Removes binary floating point noise (0.30000000000000004 → 0.3). */
export function cleanNumber(value: number): number {
  return value === 0 ? 0 : Number(value.toPrecision(12))
}

export function computeScale(request: ScaleRequest): ValueScale {
  if (request.logBase) return computeLogScale(request, request.logBase)
  let low = Number.isFinite(request.dataMin) ? request.dataMin : 0
  let high = Number.isFinite(request.dataMax) ? request.dataMax : 1
  if (low > high) [low, high] = [high, low]
  if (low === high) {
    // A flat series still needs a visible range: Excel spans from zero to the value.
    if (low > 0) low = 0
    else if (high < 0) high = 0
    else high = 1
  }
  let bottom = low
  let top = high
  if (!request.exact) {
    // Excel anchors at zero unless every value is within the top sixth of the range from zero.
    const zeroBottom = low >= 0 && low <= (high * 5) / 6
    const zeroTop = high <= 0 && high >= (low * 5) / 6
    if (low >= 0) bottom = zeroBottom ? 0 : low - (high - low) / 2
    if (high <= 0) top = zeroTop ? 0 : high + (high - low) / 2
    const span = top - bottom
    if (top > 0 && !(high <= 0)) top += span * 0.05
    if (bottom < 0 && !(low >= 0)) bottom -= span * 0.05
  }
  if (request.min !== undefined) bottom = request.min
  if (request.max !== undefined) top = request.max
  if (!(top > bottom)) top = bottom + (request.majorUnit ?? 1)

  const intervals = Math.max(1, Math.floor(request.maxIntervals))
  let majorUnit = request.majorUnit ?? niceStep((top - bottom) / intervals)
  if ((top - bottom) / majorUnit > MAX_TICKS) majorUnit = niceStep((top - bottom) / MAX_TICKS)
  const min = request.min ?? cleanNumber(Math.floor(bottom / majorUnit + 1e-9) * majorUnit)
  const max = request.max ?? cleanNumber(Math.ceil(top / majorUnit - 1e-9) * majorUnit)
  const ticks: number[] = []
  for (let index = 0; index <= MAX_TICKS; index++) {
    const value = cleanNumber(min + index * majorUnit)
    if (value > max + majorUnit * 1e-9) break
    ticks.push(value)
  }
  return { min, max: max > min ? max : min + majorUnit, majorUnit, ticks }
}

function computeLogScale(request: ScaleRequest, base: number): ValueScale {
  const positive = (value: number): number => (value > 0 && Number.isFinite(value) ? value : 1)
  const low = positive(Math.min(request.dataMin, request.dataMax))
  const high = positive(Math.max(request.dataMin, request.dataMax))
  const min = request.min !== undefined && request.min > 0 ? request.min : base ** Math.floor(Math.log(low) / Math.log(base) + 1e-9)
  let max = request.max !== undefined && request.max > 0 ? request.max : base ** Math.ceil(Math.log(high) / Math.log(base) - 1e-9)
  if (!(max > min)) max = min * base
  const ticks: number[] = []
  const steps = request.majorUnit && request.majorUnit > 1 ? request.majorUnit : 1
  for (let value = min; value <= max * (1 + 1e-9) && ticks.length <= MAX_TICKS; value *= base ** steps) ticks.push(cleanNumber(value))
  return { min, max, majorUnit: steps, logBase: base, ticks }
}

/** Where `value` falls along the axis, 0 at the minimum and 1 at the maximum (unclamped). */
export function scaleFraction(scale: ValueScale, value: number): number {
  if (scale.logBase) {
    if (value <= 0) return -1
    const logMin = Math.log(scale.min)
    return (Math.log(value) - logMin) / (Math.log(scale.max) - logMin)
  }
  return (value - scale.min) / (scale.max - scale.min)
}

/** The value where a crossing axis sits: zero when visible, else the nearest end. */
export function crossingValue(scale: ValueScale, crosses: 'autoZero' | 'min' | 'max' | number): number {
  if (crosses === 'min') return scale.min
  if (crosses === 'max') return scale.max
  const target = typeof crosses === 'number' ? crosses : scale.logBase ? scale.min : 0
  return Math.min(scale.max, Math.max(scale.min, target))
}
