const MODEL_CHART_COLORS = [
  'hsl(220 70% 55%)',
  'hsl(160 60% 45%)',
  'hsl(30 80% 50%)',
  'hsl(280 60% 55%)',
  'hsl(340 65% 55%)',
  'hsl(190 65% 45%)',
  'hsl(85 45% 45%)',
  'hsl(15 70% 55%)',
] as const

/** Assign a stable palette color based on model identity rather than chart rank. */
export function modelChartColor(modelId: string): string {
  let hash = 2_166_136_261
  for (const character of modelId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return MODEL_CHART_COLORS[(hash >>> 0) % MODEL_CHART_COLORS.length]
}
