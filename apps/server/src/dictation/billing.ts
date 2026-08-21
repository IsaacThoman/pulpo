export function dictationUsageMicros(durationSeconds: number, pricePerMinuteMicros: number): { billedSeconds: number; costMicros: number } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || pricePerMinuteMicros <= 0) return { billedSeconds: 0, costMicros: 0 }
  const billedSeconds = Math.ceil(durationSeconds)
  return { billedSeconds, costMicros: Math.ceil((billedSeconds * pricePerMinuteMicros) / 60) }
}
