import { DEFAULT_MODEL_WARNING_DISMISS_DAYS, type ModelWarningDismissals } from '@pulpo/contracts'

export interface ModelWarningSource {
  id: string
  warningMessage?: string | null
  warningDismissDays?: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DISMISSALS = 200

/** Stable FNV-1a fingerprint so an edited warning is treated as a new one. */
export function modelWarningHash(message: string): string {
  let hash = 0x811c9dc5
  for (const char of message.trim()) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function dismissalActive(
  model: ModelWarningSource,
  dismissal: ModelWarningDismissals[string] | undefined,
  message: string,
  now: number,
): boolean {
  if (!dismissal || dismissal.hash !== modelWarningHash(message)) return false
  const days = model.warningDismissDays ?? DEFAULT_MODEL_WARNING_DISMISS_DAYS
  if (days <= 0) return true
  const at = Date.parse(dismissal.at)
  return Number.isFinite(at) && at + days * DAY_MS > now
}

/** The warning to show above the composer, or null when disabled, empty, or dismissed. */
export function activeModelWarning(
  model: ModelWarningSource | null | undefined,
  dismissals: ModelWarningDismissals | null | undefined,
  options: { enabled: boolean; now?: number },
): string | null {
  const message = model?.warningMessage?.trim()
  if (!options.enabled || !model || !message) return null
  const now = options.now ?? Date.now()
  return dismissalActive(model, dismissals?.[model.id], message, now) ? null : message
}

/**
 * Record a dismissal for the model's current message. Entries that no longer
 * hide anything for known models are pruned so the synced map stays small.
 */
export function dismissModelWarning(
  dismissals: ModelWarningDismissals | null | undefined,
  model: ModelWarningSource,
  models: readonly ModelWarningSource[] = [],
  now = Date.now(),
): ModelWarningDismissals {
  const known = new Map(models.map((candidate) => [candidate.id, candidate]))
  const kept = Object.entries(dismissals ?? {}).filter(([id, dismissal]) => {
    if (id === model.id) return false
    const candidate = known.get(id)
    const message = candidate?.warningMessage?.trim()
    if (!candidate) return true
    return Boolean(message) && dismissalActive(candidate, dismissal, message!, now)
  })
  const entries = [
    ...kept,
    [model.id, { at: new Date(now).toISOString(), hash: modelWarningHash(model.warningMessage ?? '') }] as const,
  ]
    .sort(([, left], [, right]) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, MAX_DISMISSALS)
  return Object.fromEntries(entries)
}
