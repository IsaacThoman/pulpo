const MODEL_CHART_COLORS = [
  'hsl(220 70% 55%)',
  'hsl(160 60% 45%)',
  'hsl(30 80% 50%)',
  'hsl(280 60% 55%)',
  'hsl(340 65% 55%)',
  'hsl(190 65% 45%)',
  'hsl(85 45% 45%)',
  'hsl(50 85% 50%)',
] as const

/** Preferred palette slot based on model identity rather than chart rank. */
function preferredSlot(modelId: string): number {
  let hash = 2_166_136_261
  for (const character of modelId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % MODEL_CHART_COLORS.length
}

/**
 * Assign stable, distinct palette colors to the models shown together in one chart.
 * Each model starts at its hashed slot and probes forward on collision; models are
 * processed by id (not rank) so switching metrics doesn't reshuffle colors.
 */
export function modelChartColors(modelIds: readonly string[]): Map<string, string> {
  const size = MODEL_CHART_COLORS.length
  const taken = new Set<number>()
  const colors = new Map<string, string>()
  for (const modelId of [...new Set(modelIds)].sort()) {
    let slot = preferredSlot(modelId)
    for (let i = 0; i < size && taken.has(slot); i++) slot = (slot + 1) % size
    taken.add(slot)
    colors.set(modelId, MODEL_CHART_COLORS[slot])
  }
  return colors
}
