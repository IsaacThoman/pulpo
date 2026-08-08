import type { CompactionItem } from '@pulpo/contracts'

const OMITTED_IMAGE_TEXT = '[Image data omitted from persisted context]'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sanitizeValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[Circular context omitted]'
    ancestors.add(value)
    const sanitized = value.map((entry) => sanitizeValue(entry, ancestors))
    ancestors.delete(value)
    return sanitized
  }

  const item = record(value)
  if (!item) return value
  if (ancestors.has(item)) return '[Circular context omitted]'

  if (item.type === 'image' && typeof item.data === 'string') {
    return { type: 'text', text: OMITTED_IMAGE_TEXT }
  }
  if (
    item.type === 'input_image'
    && typeof item.image_url === 'string'
    && item.image_url.startsWith('data:image/')
  ) {
    return { type: 'input_text', text: OMITTED_IMAGE_TEXT }
  }

  ancestors.add(item)
  const sanitized = Object.fromEntries(
    Object.entries(item).map(([key, entry]) => [key, sanitizeValue(entry, ancestors)]),
  )
  ancestors.delete(item)
  return sanitized
}

/** Remove transient binary model context before it reaches durable JSON state. */
export function sanitizeContextForStorage<T>(value: T): T {
  return sanitizeValue(value, new WeakSet()) as T
}

/** Withhold server-only continuation context while preserving display metadata. */
export function sanitizeOutputForClient(output: unknown[]): unknown[] {
  const sanitized = sanitizeContextForStorage(output)
  return sanitized.map((raw) => {
    const item = record(raw)
    if (item?.type !== 'pulpo_compaction') return raw
    return {
      ...item,
      retained_context: [],
      retained_context_turns: [],
    } satisfies Partial<CompactionItem>
  })
}
